// Lista los modelos de Token Factory (usa NEBIUS_API_KEY de .env; no la imprime).
const base = process.env.NEBIUS_BASE_URL || "https://api.tokenfactory.nebius.com/v1";
const key = process.env.NEBIUS_API_KEY;
if (!key) {
  console.error("Falta NEBIUS_API_KEY en .env");
  process.exit(1);
}

const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` } });
if (!res.ok) {
  console.error(`Error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}

const { data } = await res.json();
const ids = data.map((m) => m.id).sort();
const filter = process.argv[2]?.toLowerCase();
console.log(`${ids.length} modelos en total`);
for (const id of ids) if (!filter || id.toLowerCase().includes(filter)) console.log(id);
