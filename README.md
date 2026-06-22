# ⚔️ Fraction Fighters

A 6th-grade fraction math game with stick figure boss battles.

## How to Play

1. **Math phase** — Solve 5 fraction problems in a row
   - Level 1: Addition
   - Level 2: Subtraction
   - Level 3: Multiplication
   - Level 4: Division
   - (cycles back to addition after level 4)
2. **Fight phase** — Beat the stick figure boss!
   - ◀ ▶ (Left/Right arrows) — Move
   - ▲ (Up arrow) — Jump
   - SPACE — Punch (get close to the boss to land it)
3. Beat the boss → level cleared → next level with a new operation and a tougher boss

## Run Locally

Just open `index.html` in any browser. No build step, no dependencies.

## Deploy

Static site — serve `index.html` from any web host or container.

### Docker

```bash
docker build -t fraction-fighters .
docker run -p 8080:80 fraction-fighters
```

Then visit http://localhost:8080

## Tech

- Pure HTML/CSS/JavaScript (no frameworks)
- Canvas 2D for the stick figure fight
- Self-contained in a single `index.html`
