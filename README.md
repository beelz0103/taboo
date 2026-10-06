# taboo
The classic taboo game, digitalized.

When using `server.js`, played-card IDs are persisted in
`.taboo-data/played-cards.json` so they survive relay restarts. Set
`PLAYED_STORE=/path/to/played-cards.json` to use a different storage location.
Only the three most recent game days are retained per room.
