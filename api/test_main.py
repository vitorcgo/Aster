import json
import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from google.genai import errors as genai_errors

from api.main import (
    AnswerBlock,
    GeneratedAnswer,
    InvalidAnswerError,
    ModelTurn,
    ToolCall,
    app,
    classify_generation_error,
    clean_pdf_text,
    gemini_models,
    material_paths,
    search,
    validate_answer,
)


def parse_events(response):
    return [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]


def turn(*calls, thoughts=()):
    return ModelTurn(list(thoughts), [ToolCall(f"c{index}-{call[0]}", call[0], call[1]) for index, call in enumerate(calls)], "", [])


HAS_MATERIALS = bool(material_paths())


class AgentTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.configured = [
            patch("api.main.gemini_api_key", return_value="configured"),
            patch("api.main.gemini_models", return_value=("primary", "backup")),
            patch.dict(os.environ, {"GEMINI_LAST_RESORT": ""}),
            patch.dict("api.main._model_blocked_until", {}, clear=True),
            patch("api.main.web_search", return_value=("wikipedia", [{"title": "RAG — Wikipédia", "url": "https://pt.wikipedia.org/wiki/RAG", "domain": "pt.wikipedia.org", "snippet": "Técnica de IA."}])),
        ]
        for item in self.configured:
            item.start()

    def tearDown(self):
        for item in self.configured:
            item.stop()

    def ask(self, question="O que são embeddings?"):
        response = self.client.post("/api/tutor/runs", json={"question": question})
        self.assertEqual(response.status_code, 200)
        return parse_events(response)

    def test_error_classes(self):
        for status, code, fallback in [(401, "invalid_key", False), (402, "billing_required", False), (403, "access_denied", False), (404, "model_unavailable", True), (429, "rate_limited", True), (503, "service_unavailable", True)]:
            with self.subTest(status=status):
                failure = classify_generation_error(genai_errors.APIError(status, {"error": {"message": "internal detail"}}))
                self.assertEqual((failure.code, failure.try_fallback), (code, fallback))
                self.assertNotIn("internal detail", failure.message)

    def test_citation_validation(self):
        with self.assertRaises(InvalidAnswerError):
            validate_answer(GeneratedAnswer(blocks=[AnswerBlock(text="Resposta.", citation_ids=["inventada"])]), {"ref-1"})
        with self.assertRaises(InvalidAnswerError):
            validate_answer(GeneratedAnswer(blocks=[AnswerBlock(text=" ", citation_ids=["ref-1"])]), {"ref-1"})
        validate_answer(GeneratedAnswer(blocks=[AnswerBlock(text="Ok.", citation_ids=["ref-1", "web-1"])]), {"ref-1", "web-1"})

    @unittest.skipUnless(HAS_MATERIALS, "PDFs das aulas ausentes")
    def test_agent_searches_reads_browses_and_answers(self):
        hit = search("embeddings vetores")[0]
        script = [
            turn(("buscar_nas_aulas", {"consulta": "embeddings vetores"}), thoughts=["Vou procurar embeddings nas aulas."]),
            turn(("ler_pagina", {"aula": hit.document_id, "pagina": hit.page})),
            turn(("pesquisar_na_web", {"consulta": "embeddings RAG"})),
            turn(("responder", {"blocos": [{"texto": "Embeddings são vetores.", "citacoes": [hit.id]}, {"texto": "Fora das aulas, RAG é uma técnica.", "citacoes": ["web-1"]}]})),
        ]
        with patch("api.main.call_model", side_effect=script) as model:
            events = self.ask()
        kinds = [event["type"] for event in events]
        for expected in ["agent_thought", "tool_call", "search_results", "page_read", "web_results", "answer_check", "answer_ready"]:
            self.assertIn(expected, kinds)
        self.assertEqual(model.call_count, 4)
        ready = events[-1]
        self.assertEqual(ready["type"], "answer_ready")
        self.assertEqual({source["kind"] for source in ready["data"]["sources"]}, {"aula", "web"})
        page = next(event for event in events if event["type"] == "page_read")
        self.assertEqual(page["data"]["page"], hit.page)

    @unittest.skipUnless(HAS_MATERIALS, "PDFs das aulas ausentes")
    def test_rejected_citation_is_sent_back_for_correction(self):
        hit = search("overfitting")[0]
        script = [
            turn(("buscar_nas_aulas", {"consulta": "overfitting"})),
            turn(("responder", {"blocos": [{"texto": "Resposta.", "citacoes": ["inventada"]}]})),
            turn(("responder", {"blocos": [{"texto": "Overfitting é decorar o treino.", "citacoes": [hit.id]}]})),
        ]
        with patch("api.main.call_model", side_effect=script):
            events = self.ask()
        checks = [event["data"]["ok"] for event in events if event["type"] == "answer_check"]
        self.assertEqual(checks, [False, True])
        self.assertEqual(events[-1]["type"], "answer_ready")
        self.assertFalse(events[-1]["data"]["used_fallback"])

    @unittest.skipUnless(HAS_MATERIALS, "PDFs das aulas ausentes")
    def test_unavailable_primary_restarts_on_backup(self):
        hit = search("overfitting")[0]
        temporary = genai_errors.APIError(503, {"error": {"message": "unavailable"}})
        script = [temporary, turn(("buscar_nas_aulas", {"consulta": "overfitting"})), turn(("responder", {"blocos": [{"texto": "Ok.", "citacoes": [hit.id]}]}))]
        with patch("api.main.call_model", side_effect=script) as model:
            events = self.ask()
        self.assertEqual([call.args[0] for call in model.call_args_list], ["primary", "backup", "backup"])
        self.assertIn("model_fallback", [event["type"] for event in events])
        self.assertEqual((events[-1]["data"]["model"], events[-1]["data"]["used_fallback"]), ("backup", True))

    @unittest.skipUnless(HAS_MATERIALS, "PDFs das aulas ausentes")
    def test_rate_limited_model_is_skipped_next_time(self):
        hit = search("overfitting")[0]
        limited = genai_errors.APIError(429, {"error": {"message": "quota"}})
        answer = lambda: turn(("responder", {"blocos": [{"texto": "Ok.", "citacoes": [hit.id]}]}))
        search_turn = lambda: turn(("buscar_nas_aulas", {"consulta": "overfitting"}))
        with patch("api.main.call_model", side_effect=[limited, search_turn(), answer(), search_turn(), answer()]) as model:
            first = self.ask()
            second = self.ask()
        self.assertEqual([call.args[0] for call in model.call_args_list], ["primary", "backup", "backup", "backup", "backup"])
        self.assertTrue(first[-1]["data"]["used_fallback"])
        self.assertTrue(second[-1]["data"]["used_fallback"])
        self.assertIn("sem cota", next(event for event in second if event["type"] == "model_fallback")["data"]["message"])

    def test_invalid_key_stops_before_backup(self):
        rejected = genai_errors.APIError(401, {"error": {"message": "secret detail"}})
        with patch("api.main.call_model", side_effect=rejected) as model:
            events = self.ask()
        self.assertEqual(model.call_count, 1)
        self.assertEqual(events[-1]["data"]["code"], "invalid_key")
        self.assertNotIn("secret detail", events[-1]["data"]["message"])

    def test_both_models_failing_return_safe_error(self):
        unavailable = genai_errors.APIError(503, {"error": {"message": "private server detail"}})
        with patch("api.main.call_model", side_effect=[unavailable, unavailable]) as model:
            events = self.ask()
        self.assertEqual(model.call_count, 2)
        self.assertEqual(events[-1]["type"], "run_failed")
        self.assertEqual(events[-1]["data"]["code"], "service_unavailable")
        self.assertNotIn("private server detail", events[-1]["data"]["message"])

    def test_greeting_is_answered_without_research(self):
        with patch("api.main.call_model", side_effect=[turn(("conversar", {"texto": "Oi! Eu sou o Aster."}))]):
            events = self.ask("Olá, quem é você?")
        self.assertEqual(events[-1]["type"], "answer_ready")
        self.assertEqual(events[-1]["data"]["kind"], "chat")
        self.assertEqual(events[-1]["data"]["sources"], [])

    def test_no_coverage_and_blank_question(self):
        with patch("api.main.call_model", side_effect=[turn(("sem_base", {"motivo": "Assunto fora da disciplina."}))]):
            self.assertEqual(self.ask("Quem ganhou a copa de 1970?")[-1]["type"], "insufficient_evidence")
        response = self.client.post("/api/tutor/runs", json={"question": "   "})
        self.assertEqual(response.status_code, 422)


class LibraryTest(unittest.TestCase):
    def test_configured_models_are_unique(self):
        with patch.dict(os.environ, {"GEMINI_MODEL": "gemini-4-hydrogen", "GEMINI_FALLBACK_MODEL": "gemini-4-hydrogen"}):
            self.assertEqual(gemini_models(), ("gemini-4-hydrogen",))
    def test_glyph_fixes(self):
        self.assertEqual(clean_pdf_text("Ao Ąnal da aula, vocŸ será capaz"), "Ao final da aula, você será capaz")
        self.assertEqual(clean_pdf_text("Inteligência Artiőcial"), "Inteligência Artificial")

    @unittest.skipUnless(HAS_MATERIALS, "PDFs das aulas ausentes")
    def test_search_handles_word_variations(self):
        self.assertTrue(search("alucinações"))
        self.assertEqual(search("teste de Turing")[0].document_id, "aula-1")


if __name__ == "__main__":
    unittest.main()
