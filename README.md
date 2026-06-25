# MacroLeia

MacroLeia e um app web simples para guardar macros de texto por usuario. Ele foi pensado para ficar confortavel em janelas estreitas, lado a lado com outro navegador ou aplicativo, e copiar mensagens com um clique.

## Recursos

- Login com usuario e senha, usando cookie HTTP-only.
- Cadastro local com usuario, email e senha.
- Dados isolados por usuario.
- Reset de senha usando usuario, email e nova senha.
- Lista de macros com criacao, edicao, exclusao e renomeacao.
- Ordem editavel com botoes de subir e descer.
- Tela de macro com botoes numerados que exibem e copiam a mensagem.
- Editor de textos para cada botao.
- Layout escuro e responsivo para janelas estreitas.
- Backend FastAPI com SQLite local e Firestore no Cloud Run.
- Dockerfile e `cloudbuild.yaml` prontos para Cloud Run.

## Estrutura

```text
MacroLeia/
  backend/
    app/
      main.py
    tests/
      test_api.py
    requirements.txt
    requirements-dev.txt
  frontend/
    static/
      index.html
      app.js
      styles.css
  data/
    .gitkeep
  Dockerfile
  cloudbuild.yaml
  README.md
```

## Rodar localmente

Requisitos:

- Python 3.12 ou superior.

Passos no PowerShell:

```powershell
cd C:\CodeProjects\MacroLeia
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

Abra:

```text
http://127.0.0.1:8000
```

O banco local fica em `data/macroleia.db`. Esse arquivo nao entra no Git.

## Testes

```powershell
cd C:\CodeProjects\MacroLeia
pip install -r backend\requirements-dev.txt
pytest backend\tests -q
```

## Rodar com Docker

```powershell
cd C:\CodeProjects\MacroLeia
docker build -t macroleia .
docker run --rm -p 8080:8080 -v ${PWD}\data:/app/data macroleia
```

Abra:

```text
http://127.0.0.1:8080
```

## Preparar Git

```powershell
cd C:\CodeProjects\MacroLeia
git status
git add .
git commit -m "Initial MacroLeia app"
```

## Deploy no Cloud Run

O projeto ja inclui `Dockerfile` e `cloudbuild.yaml`. Quando chegar a hora de publicar, ajuste a regiao e o repositorio se quiser:

```yaml
substitutions:
  _REGION: us-central1
  _REPOSITORY: cloud-run-source-deploy
```

Deploy usando Cloud Build:

```powershell
gcloud builds submit --config cloudbuild.yaml .
```

No Cloud Run, use Firestore para persistir dados mesmo quando o servico escala a zero.

## Variaveis de ambiente

- `MACROLEIA_DB`: caminho do banco SQLite. Padrao local: `data/macroleia.db`. Padrao Docker: `/app/data/macroleia.db`.
- `MACROLEIA_STORAGE`: use `sqlite` localmente ou `firestore` no Cloud Run. Padrao: `sqlite`.
- `PORT`: porta usada pelo servidor no container. Padrao Docker: `8080`.

## Logo

O arquivo `frontend/static/logo.png` aparece no topo das telas do app. Para trocar a marca, substitua esse PNG mantendo o mesmo nome.

## Proximos passos sugeridos

- Criar exportacao/importacao das macros por usuario.
