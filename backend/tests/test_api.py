import asyncio

import httpx
import pytest

from backend.app import main


@pytest.fixture()
def client(tmp_path):
    main.DB_PATH = tmp_path / "test.db"
    main.init_db()
    transport = httpx.ASGITransport(app=main.app)

    async def request(method, path, cookies, **kwargs):
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
            cookies=cookies,
        ) as async_client:
            response = await async_client.request(method, path, **kwargs)
            return response, async_client.cookies

    yield ApiClient(request)
    asyncio.run(transport.aclose())


class ApiClient:
    def __init__(self, request):
        self.request = request
        self.cookies = httpx.Cookies()

    def get(self, path, **kwargs):
        return self._send("GET", path, **kwargs)

    def post(self, path, **kwargs):
        return self._send("POST", path, **kwargs)

    def put(self, path, **kwargs):
        return self._send("PUT", path, **kwargs)

    def delete(self, path, **kwargs):
        return self._send("DELETE", path, **kwargs)

    def _send(self, method, path, **kwargs):
        response, cookies = asyncio.run(self.request(method, path, self.cookies, **kwargs))
        self.cookies = cookies
        return response


def register(client, username="marco", email="marco@example.com", password="segredo1"):
    response = client.post(
        "/api/auth/register",
        json={"username": username, "email": email, "password": password},
    )
    assert response.status_code == 201
    return response.json()["user"]


def login(client, username="marco", password="segredo1"):
    response = client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200
    return response.json()["user"]


def test_requires_login_for_macros(client):
    response = client.get("/api/macros")

    assert response.status_code == 401


def test_register_create_update_reorder_and_delete_macro(client):
    register(client)

    first = client.post(
        "/api/macros",
        json={
            "name": "Atendimento",
            "buttons": [
                {"label": "1", "message": "Ola"},
                {"label": "2", "message": "Obrigado"},
            ],
        },
    )
    second = client.post(
        "/api/macros",
        json={"name": "Financeiro", "buttons": [{"label": "1", "message": "Pix enviado"}]},
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert client.get("/api/macros").json()["macros"][0]["name"] == "Atendimento"

    second_id = second.json()["macro"]["id"]
    moved = client.post(f"/api/macros/{second_id}/reorder", json={"direction": "up"})

    assert moved.status_code == 200
    assert [item["name"] for item in moved.json()["macros"]] == ["Financeiro", "Atendimento"]

    updated = client.put(
        f"/api/macros/{second_id}",
        json={"name": "Financeiro novo", "buttons": [{"label": "1", "message": "Novo texto"}]},
    )

    assert updated.status_code == 200
    assert updated.json()["macro"]["name"] == "Financeiro novo"
    assert updated.json()["macro"]["buttons"][0]["message"] == "Novo texto"

    deleted = client.delete(f"/api/macros/{second_id}")

    assert deleted.status_code == 204
    assert [item["name"] for item in client.get("/api/macros").json()["macros"]] == ["Atendimento"]


def test_macro_supports_image_buttons(client):
    register(client)
    image_data = "data:image/png;base64,iVBORw0KGgo="

    created = client.post(
        "/api/macros",
        json={
            "name": "Imagem",
            "buttons": [
                {"label": "ready-image", "message": image_data, "content_type": "image"},
            ],
        },
    )

    assert created.status_code == 201
    button = created.json()["macro"]["buttons"][0]
    assert button["content_type"] == "image"
    assert button["message"] == image_data


def test_users_cannot_access_each_others_macros(client):
    register(client, "ana", "ana@example.com", "segredo1")
    created = client.post(
        "/api/macros",
        json={"name": "Privada", "buttons": [{"label": "1", "message": "Somente Ana"}]},
    )
    macro_id = created.json()["macro"]["id"]
    client.post("/api/auth/logout")

    register(client, "bia", "bia@example.com", "segredo2")

    assert client.get("/api/macros").json()["macros"] == []
    assert client.get(f"/api/macros/{macro_id}").status_code == 404
    assert client.put(f"/api/macros/{macro_id}", json={"name": "Tentativa", "buttons": []}).status_code == 404


def test_reset_password_checks_email_and_invalidates_sessions(client):
    register(client)

    bad_reset = client.post(
        "/api/auth/reset-password",
        json={"username": "marco", "email": "errado@example.com", "new_password": "novasenha"},
    )

    assert bad_reset.status_code == 404

    reset = client.post(
        "/api/auth/reset-password",
        json={"username": "marco", "email": "marco@example.com", "new_password": "novasenha"},
    )

    assert reset.status_code == 204
    assert client.get("/api/me").status_code == 401
    assert client.post("/api/auth/login", json={"username": "marco", "password": "segredo1"}).status_code == 401
    login(client, password="novasenha")
    assert client.get("/api/me").status_code == 200
