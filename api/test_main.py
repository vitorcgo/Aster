import json
import os
import tempfile
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
        self.folder = tempfile.TemporaryDirectory()
        self.client = TestClient(app)
        self.configured = [
            patch("api.main.gemini_api_key", return_value="configured"),
            patch("api.main.gemini_models", return_value=("primary", "backup")),
            patch.dict(os.environ, {"GEMINI_LAST_RESORT": "", "ASTER_SETTINGS": os.path.join(self.folder.name, "settings.json"), "OPENAI_API_KEY": "", "NVIDIA_API_KEY": ""}),
            patch.dict("api.main._model_blocked_until", {}, clear=True),
            patch("api.main.web_search", return_value=("wikipedia", [{"title": "RAG — Wikipédia", "url": "https://pt.wikipedia.org/wiki/RAG", "domain": "pt.wikipedia.org", "snippet": "Técnica de IA."}])),
        ]
        for item in self.configured:
            item.start()

    def tearDown(self):
        for item in self.configured:
            item.stop()
        self.folder.cleanup()

    def ask(self, question="O que são embeddings?"):
        response = self.client.post("/api/tutor/runs", json={"question": question})
        self.assertEqual(response.status_code, 200)
        return parse_events(response)

    def test_error_classes(self):
        for status, code, fallback in [(401, "invalid_key", True), (402, "billing_required", True), (403, "access_denied", True), (404, "model_unavailable", True), (429, "rate_limited", True), (503, "service_unavailable", True)]:
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

    def test_refused_key_moves_to_next_model_without_leaking(self):
        rejected = genai_errors.APIError(401, {"error": {"message": "secret detail"}})
        with patch("api.main.call_model", side_effect=rejected) as model:
            events = self.ask()
        self.assertEqual(model.call_count, 2)
        self.assertEqual(events[-1]["data"]["code"], "invalid_key")
        self.assertNotIn("secret detail", events[-1]["data"]["message"])

    @unittest.skipUnless(HAS_MATERIALS, "PDFs das aulas ausentes")
    def test_chain_from_page_uses_openai_session(self):
        hit = search("overfitting")[0]
        self.client.put("/api/settings/keys/openai", json={"key": "sk-test-1234567890"})
        self.client.put("/api/settings/chain", json={"chain": [{"provider": "openai", "model": "gpt-teste"}]})
        sessions = []

        def fake(model, session, force_final=False):
            sessions.append((model, type(session).__name__))
            return turn(("responder", {"blocos": [{"texto": "Ok.", "citacoes": [hit.id]}]})) if len(sessions) > 1 else turn(("buscar_nas_aulas", {"consulta": "overfitting"}))

        with patch("api.main.call_model", side_effect=fake):
            events = self.ask()
        self.assertEqual(sessions, [("gpt-teste", "ChatSession"), ("gpt-teste", "ChatSession")])
        self.assertEqual((events[-1]["data"]["provider"], events[-1]["data"]["model"]), ("openai", "gpt-teste"))

    def test_settings_never_return_full_key(self):
        response = self.client.put("/api/settings/keys/nvidia", json={"key": "nvapi-abcdefghijklmnop"})
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("abcdefghijklmnop", response.text)
        nvidia = next(item for item in response.json()["providers"] if item["id"] == "nvidia")
        self.assertEqual((nvidia["configured"], nvidia["source"], nvidia["masked"]), (True, "page", "••••mnop"))
        removed = self.client.delete("/api/settings/keys/nvidia").json()
        self.assertFalse(next(item for item in removed["providers"] if item["id"] == "nvidia")["configured"])
        self.assertEqual(self.client.put("/api/settings/keys/desconhecido", json={"key": "12345678"}).status_code, 404)

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

    def test_server_caps_web_searches(self):
        script = [
            turn(("pesquisar_na_web", {"consulta": "a"})),
            turn(("pesquisar_na_web", {"consulta": "b"})),
            turn(("pesquisar_na_web", {"consulta": "c"})),
            turn(("responder", {"blocos": [{"texto": "Fora das aulas, RAG é uma técnica.", "citacoes": ["web-1"]}]})),
        ]
        with patch("api.main.call_model", side_effect=script):
            events = self.ask("o que é RAG?")
        self.assertEqual(sum(1 for event in events if event["type"] == "web_results"), 2)
        self.assertEqual([event["data"]["message"] for event in events if event["type"] == "tool_error"], ["Limite de pesquisas na web atingido"])
        self.assertEqual(events[-1]["type"], "answer_ready")

    def test_giving_up_with_web_sources_is_reconsidered_once(self):
        script = [
            turn(("pesquisar_na_web", {"consulta": "rag"})),
            turn(("sem_base", {"motivo": "nada"})),
            turn(("responder", {"blocos": [{"texto": "Fora das aulas, RAG é uma técnica.", "citacoes": ["web-1"]}]})),
        ]
        with patch("api.main.call_model", side_effect=script):
            events = self.ask("o que é RAG?")
        self.assertEqual(events[-1]["type"], "answer_ready")
        stubborn = [turn(("pesquisar_na_web", {"consulta": "rag"})), turn(("sem_base", {"motivo": "nada"})), turn(("sem_base", {"motivo": "nada mesmo"}))]
        with patch("api.main.call_model", side_effect=stubborn):
            events = self.ask("o que é RAG?")
        self.assertEqual((events[-1]["type"], events[-1]["data"]["reason"]), ("insufficient_evidence", "nada mesmo"))

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


@unittest.skipUnless(HAS_MATERIALS, "PDFs das aulas ausentes")
class LabTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_nlp_shows_each_step_of_the_pipeline(self):
        data = self.client.get("/api/lab/nlp", params={"q": "Quais são as alucinações dos LLMs?"}).json()
        self.assertIn("quais", data["stopwords_removed"])
        self.assertIn({"word": "alucinacoes", "stem": "alucina"}, data["stems"])
        self.assertEqual(data["terms"], sorted({item["stem"] for item in data["stems"]}))

    def test_search_breakdown_matches_agent_search(self):
        data = self.client.get("/api/lab/search", params={"q": "O que é overfitting?", "limit": 6}).json()
        self.assertEqual([item["id"] for item in data["candidates"]], [item.id for item in search("O que é overfitting?")])
        self.assertTrue(all(item["score"] > 0 for item in data["candidates"]))

    def test_page_detail_reports_glyph_fixes(self):
        data = self.client.get("/api/lab/page", params={"doc": "aula-11", "page": 2}).json()
        self.assertIn("Ą", {item["from"] for item in data["fixes"]})
        self.assertNotIn("Ą", data["clean"])

    def test_evaluation_and_relevance_use_the_labeled_set(self):
        evaluation = self.client.get("/api/lab/evaluation").json()
        self.assertEqual(len(evaluation["results"]), 26)
        self.assertGreaterEqual(evaluation["metrics"]["recall@6"], evaluation["metrics"]["recall@1"])
        relevance = self.client.get("/api/lab/relevance").json()
        positives = sum(candidate["y"] for query in relevance["queries"] for candidate in query["candidates"])
        self.assertGreater(positives, 10)

    def test_agent_view_exposes_prompt_and_tools(self):
        data = self.client.get("/api/lab/agent").json()
        self.assertIn("Você é o Aster", data["system_prompt"])
        self.assertIn("buscar_nas_aulas", [tool["name"] for tool in data["tools"]])


class LocalOnlyTest(unittest.TestCase):
    def test_settings_changes_refuse_requests_from_the_network(self):
        client = TestClient(app)
        with patch.dict(os.environ, {"ASTER_SETTINGS": os.path.join(tempfile.gettempdir(), "aster-settings-test.json")}):
            response = client.put("/api/settings/chain", json={"chain": []}, headers={"X-Forwarded-For": "192.168.0.9"})
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.json()["detail"]["code"], "local_only")
            self.assertEqual(client.put("/api/settings/chain", json={"chain": []}).status_code, 200)


@unittest.skipUnless(HAS_MATERIALS, "PDFs das aulas ausentes")
class RelevanceTest(unittest.TestCase):
    def test_off_topic_questions_do_not_find_noise(self):
        self.assertEqual(search("quem ganhou a copa de 2022"), [])
        self.assertTrue(all("siri" in passage.quote.lower() for passage in search("como faz um hamburguer de siri")))

    def test_filter_keeps_the_right_pages(self):
        self.assertEqual((search("Qual a fórmula do recall?")[0].document_id, search("Qual a fórmula do recall?")[0].page), ("aula-2", 32))
        self.assertTrue(search("O que é tokenização em PLN?"))

