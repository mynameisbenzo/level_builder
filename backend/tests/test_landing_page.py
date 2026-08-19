from app.main import create_app


def test_landing_page_returns_ok_and_html():
    app = create_app("testing")
    client = app.test_client()

    response = client.get("/")

    assert response.status_code == 200
    assert response.content_type.startswith("text/html")


def test_landing_page_includes_tech_stack_and_links():
    app = create_app("testing")
    client = app.test_client()

    response = client.get("/")
    body = response.get_data(as_text=True)

    assert "LEVEL BUILDER" in body
    assert "SvelteKit" in body
    assert "Flask" in body
    assert app.config["GITHUB_URL"] in body
    assert app.config["FRONTEND_ORIGIN"] in body