from unittest.mock import Mock

import pytest
from google.genai import errors

from app.services import llm


def make_api_error(code):
    return errors.APIError(
        code,
        {"error": {"code": code, "message": "Test error"}},
    )


def attempted_models(client):
    return [
        call.kwargs["model"]
        for call in client.models.generate_content.call_args_list
    ]


def test_primary_model_succeeds():
    client = Mock()
    response = Mock()
    client.models.generate_content.return_value = response

    result = llm.generate_content_with_fallback(
        client, contents="Test prompt"
    )

    assert result is response
    assert attempted_models(client) == [llm.GEMINI_MODELS[0]]


def test_fallback_after_503():
    client = Mock()
    response = Mock()

    client.models.generate_content.side_effect = [
        make_api_error(503),
        response,
    ]

    result = llm.generate_content_with_fallback(
        client, contents="Test prompt"
    )

    assert result is response
    assert attempted_models(client) == list(llm.GEMINI_MODELS[:2])


def test_multiple_busy_models():
    client = Mock()
    response = Mock()

    client.models.generate_content.side_effect = [
        make_api_error(503),
        make_api_error(503),
        response,
    ]

    result = llm.generate_content_with_fallback(
        client, contents="Test prompt"
    )

    assert result is response
    assert attempted_models(client) == list(llm.GEMINI_MODELS[:3])


def test_all_models_busy():
    client = Mock()

    client.models.generate_content.side_effect = [
        make_api_error(503) for _ in llm.GEMINI_MODELS
    ]

    with pytest.raises(llm.LLMServiceError) as exc:
        llm.generate_content_with_fallback(
            client, contents="Test prompt"
        )

    assert "All AI models are currently busy" in str(exc.value)
    assert exc.value.retry is True
    assert attempted_models(client) == list(llm.GEMINI_MODELS)


@pytest.mark.parametrize("code", [400, 401, 403, 404, 429, 500])
def test_other_errors_do_not_trigger_fallback(code):
    client = Mock()
    client.models.generate_content.side_effect = make_api_error(code)

    with pytest.raises(errors.APIError) as exc:
        llm.generate_content_with_fallback(
            client, contents="Test prompt"
        )

    assert exc.value.code == code
    assert attempted_models(client) == [llm.GEMINI_MODELS[0]]


def test_timeout_does_not_trigger_fallback():
    client = Mock()
    client.models.generate_content.side_effect = TimeoutError()

    with pytest.raises(TimeoutError):
        llm.generate_content_with_fallback(
            client, contents="Test prompt"
        )

    assert attempted_models(client) == [llm.GEMINI_MODELS[0]]


def test_request_parameters_preserved():
    client = Mock()
    config = {"response_mime_type": "application/json"}

    client.models.generate_content.side_effect = [
        make_api_error(503),
        Mock(),
    ]

    llm.generate_content_with_fallback(
        client,
        contents="Test prompt",
        config=config,
    )

    for call in client.models.generate_content.call_args_list:
        assert call.kwargs["contents"] == "Test prompt"
        assert call.kwargs["config"] == config