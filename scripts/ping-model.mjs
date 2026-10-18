// Llamada mínima a un modelo de Token Factory para comprobar que responde.
const base = process.env.NEBIUS_BASE_URL || "https://api.tokenfactory.nebius.com/v1";
const model = process.argv[2];
const started = Date.now();

const res = await fetch(`${base}/chat/completions`, {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.NEBIUS_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model,
    max_tokens: 400,
    messages: [{ role: "user", content: "In one sentence: what does `using (true)` in a Postgres RLS policy mean?" }],
  }),
});
if (!res.ok) {
  console.error(`${model} → Error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}

const json = await res.json();
console.log(`${model} (${Date.now() - started} ms, ${json.usage?.total_tokens} tokens)`);
console.log(json.choices[0].message.content?.trim());
