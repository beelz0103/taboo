# taboo
The classic taboo game, digitalized.

## Run with Docker

Start the app with Docker Compose:

```sh
docker compose up --build
```

Then open <http://localhost:7331> on the computer running Docker. To host a
game, copy the generated key from the `?host=...` URL in the container logs and
open `http://localhost:7331/?host=<key>`. Other devices on the same network can
join at `http://<your-computer-ip>:7331`.

Played-card history is kept in the `taboo-data` Docker volume. The following
environment variables are optional:

```sh
TABOO_PORT=9000 HOST_KEY=MYSECRET docker compose up --build
```

- `TABOO_PORT` changes the port published on the host (default: `7331`).
- `HOST_KEY` provides a stable host key. If omitted, a random key is printed
  whenever the container starts.

To run the image without Compose:

```sh
docker build -t taboo .
docker run --rm -p 7331:7331 -v taboo-data:/app/.taboo-data taboo
```

## Run directly

When using `server.js`, played-card IDs are persisted in
`.taboo-data/played-cards.json` so they survive relay restarts. Set
`PLAYED_STORE=/path/to/played-cards.json` to use a different storage location.
Only the three most recent game days are retained per room.

```sh
node server.js
```

## Curate the Japanese master deck

Start the server and open <http://localhost:7331/curate>. The curation tool can
search and filter all cards, edit fields and forbidden words, exclude unsuitable
cards, add new cards, and export a replacement `japanese-master.js`. Work in
progress is saved in the browser; the source file is changed only when you
download and replace it explicitly.

The 3,000-card curated deck opens directly for review. To rebuild the target
selection from the full source deck before reviewing its NG words, run:

```sh
node tools/curate-japanese-master.js
```
