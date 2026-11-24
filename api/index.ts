// Natal 2026 – servidor: confirmações, configurações, pagamentos, gastos e fotos.
// Guarda tudo em um arquivo JSON no volume (/data). Sem dependências.

const DIR = Bun.env.DATA_DIR || "/data";
const ARQ = `${DIR}/natal.json`;
const ORIGENS = ["https://matheusadvac-svg.github.io", ...(Bun.env.ORIGEM_EXTRA ? [Bun.env.ORIGEM_EXTRA] : [])];
const FAIXAS = ["adulto", "adolescente", "crianca", "bebe"];

const CONFIG_PADRAO: any = {
  titulo1: "Natal", titulo2: "em casa",
  data: "2026-12-24T21:00:00-05:00",
  quando: "24 de dezembro, a partir das 21h",
  onde: "na casa do Matheus e da Madu",
  prazo: "Só até 30 de novembro. Quem não confirmar fica fora da lista.",
  aberto: true, meta: 40, mostrarValores: true,
  precos: { adulto: 100, adolescente: 75, crianca: 50, bebe: 0 },
  incluso: [
    { icone: "🍽️", titulo: "Ceia completa", detalhe: "Carnes natalinas, arroz, farofa, salada e sobremesas do O Segredo Buffet" },
    { icone: "🥤", titulo: "Refrigerante, suco, água e gelo", detalhe: "" },
    { icone: "🎁", titulo: "Bingo e brincadeiras com prêmios", detalhe: "" },
    { icone: "🎄", titulo: "Decoração e descartáveis", detalhe: "" },
  ],
  traga: "Bebida alcoólica: cada um traz a sua, na própria geleira.",
  aviso: "",
  pix: { mostrar: false, chave: "", nome: "", obs: "" },
  programacao: [], cardapio: [],
  rodape: "Com carinho, Matheus e Madu ❤️",
};

let st: any = { config: CONFIG_PADRAO, pessoas: [], gastos: [], senhaHash: "", sessoes: {}, seq: 1 };
{
  const f = Bun.file(ARQ);
  if (await f.exists()) { const d = await f.json(); st = { ...st, ...d, config: { ...CONFIG_PADRAO, ...(d.config || {}) } }; }
  else {
    const em = "2026-11-23T23:24:00.000Z";
    st.pessoas = [
      { id: 1, familia: "F1", nome: "Matheus", faixa: "adulto", valor: 100, pago: false, em },
      { id: 2, familia: "F1", nome: "Maria Eduarda", faixa: "adulto", valor: 100, pago: false, em },
    ];
    st.seq = 3;
    await Bun.write(ARQ, JSON.stringify(st));
  }
}
let fila: Promise<any> = Promise.resolve();
const salvar = () => (fila = fila.then(() => Bun.write(ARQ, JSON.stringify(st))).catch(e => console.error("erro ao salvar", e)));

// ---------- utilidades ----------
const txt = (v: any, max = 300) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, max);
const num = (v: any, min = 0, max = 100000) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min; };
const lista = (v: any, max: number, f: (x: any) => any) => (Array.isArray(v) ? v.slice(0, max).map(f) : []);
const tentativas = new Map<string, number[]>();
function limite(chave: string, max: number, janelaMs: number) {
  const agora = Date.now(); const l = (tentativas.get(chave) || []).filter(t => agora - t < janelaMs);
  if (l.length >= max) { tentativas.set(chave, l); return false; }
  l.push(agora); tentativas.set(chave, l); return true;
}
const ipDe = (req: Request) => (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "sem-ip";

function limpaConfig(c: any) {
  const p = c?.precos || {}, x = c?.pix || {};
  return {
    titulo1: txt(c.titulo1, 30) || "Natal", titulo2: txt(c.titulo2, 30),
    data: isNaN(Date.parse(c.data)) ? CONFIG_PADRAO.data : txt(c.data, 40),
    quando: txt(c.quando, 80), onde: txt(c.onde, 80), prazo: txt(c.prazo, 200),
    aberto: !!c.aberto, meta: Math.round(num(c.meta, 1, 500)), mostrarValores: !!c.mostrarValores,
    precos: { adulto: num(p.adulto, 0, 10000), adolescente: num(p.adolescente, 0, 10000), crianca: num(p.crianca, 0, 10000), bebe: num(p.bebe, 0, 10000) },
    incluso: lista(c.incluso, 12, i => ({ icone: txt(i.icone, 8), titulo: txt(i.titulo, 80), detalhe: txt(i.detalhe, 200) })).filter(i => i.titulo),
    traga: txt(c.traga, 200), aviso: txt(c.aviso, 400),
    pix: { mostrar: !!x.mostrar, chave: txt(x.chave, 120), nome: txt(x.nome, 80), obs: txt(x.obs, 200) },
    programacao: lista(c.programacao, 20, i => ({ hora: txt(i.hora, 12), texto: txt(i.texto, 120) })).filter(i => i.texto),
    cardapio: lista(c.cardapio, 30, i => ({ nome: txt(i.nome, 80), descricao: txt(i.descricao, 300), foto: /^[a-z0-9-]{8,40}$/.test(String(i.foto || "")) ? String(i.foto) : "" })).filter(i => i.nome),
    rodape: txt(c.rodape, 120),
  };
}

function publico() {
  const c = st.config; const mapa: any = {}; const familias: any[] = []; let total = 0, pago = 0;
  for (const p of st.pessoas) {
    if (!mapa[p.familia]) { mapa[p.familia] = { nomes: [] }; familias.push(mapa[p.familia]); }
    mapa[p.familia].nomes.push({ nome: p.nome, faixa: p.faixa, pago: c.mostrarValores ? !!p.pago : false });
    total += p.valor; if (p.pago) pago += p.valor;
  }
  const cfg = { ...c, pix: c.pix.mostrar ? c.pix : { mostrar: false } };
  return { ok: true, config: cfg, pessoas: st.pessoas.length, familias, ...(c.mostrarValores ? { total, pago } : {}) };
}

function autenticado(req: Request) {
  const t = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const exp = t && st.sessoes[t];
  return !!exp && exp > Date.now();
}
async function novaSessao() {
  const agora = Date.now();
  for (const k of Object.keys(st.sessoes)) if (st.sessoes[k] < agora) delete st.sessoes[k];
  const t = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
  st.sessoes[t] = agora + 30 * 86400000; await salvar(); return t;
}

// ---------- servidor ----------
Bun.serve({
  port: Number(Bun.env.PORT || 3000),
  maxRequestBodySize: 3 * 1024 * 1024,
  async fetch(req) {
    const url = new URL(req.url); const rota = url.pathname.replace(/\/+$/, "") || "/"; const m = req.method;
    const origem = req.headers.get("origin") || "";
    const cors: any = {
      "Access-Control-Allow-Origin": ORIGENS.includes(origem) ? origem : ORIGENS[0], "Vary": "Origin",
      "Access-Control-Allow-Headers": "content-type, authorization", "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS", "Access-Control-Max-Age": "86400",
    };
    const json = (o: any, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
    const corpo = async () => { try { return await req.json(); } catch { return {}; } };
    try {
      if (m === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      if (rota === "/" && m === "GET") return json({ ok: true, servico: "natal-2026" });
      if (rota === "/api/publico" && m === "GET") return json(publico());

      const foto = rota.match(/^\/fotos\/([a-z0-9-]{8,40})$/);
      if (foto && m === "GET") {
        const f = Bun.file(`${DIR}/fotos/${foto[1]}.jpg`);
        if (!(await f.exists())) return json({ ok: false, erro: "Foto não encontrada." }, 404);
        return new Response(f, { headers: { ...cors, "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable" } });
      }

      if (rota === "/api/confirmar" && m === "POST") {
        if (!st.config.aberto) return json({ ok: false, erro: "As confirmações estão encerradas. Fale com o Matheus." }, 403);
        if (!limite("conf:" + ipDe(req), 12, 3600000)) return json({ ok: false, erro: "Muitas confirmações seguidas. Tente de novo mais tarde." }, 429);
        const d = await corpo();
        const ps = lista(d.pessoas, 30, p => ({ nome: txt(p.nome, 60), faixa: String(p.faixa) })).filter(p => p.nome.length >= 2 && FAIXAS.includes(p.faixa));
        if (!ps.length || ps.length !== (d.pessoas || []).length) return json({ ok: false, erro: "Escreva o nome de cada pessoa." }, 400);
        const familia = "F" + Date.now().toString(36) + Math.floor(Math.random() * 1000); const em = new Date().toISOString();
        for (const p of ps) st.pessoas.push({ id: st.seq++, familia, nome: p.nome, faixa: p.faixa, valor: st.config.precos[p.faixa], pago: false, em });
        await salvar(); return json({ ok: true });
      }

      // ----- senha -----
      if (rota === "/api/senha" && m === "GET") return json({ ok: true, criada: !!st.senhaHash });
      if (rota === "/api/criar-senha" && m === "POST") {
        if (st.senhaHash) return json({ ok: false, erro: "A senha já foi criada." }, 403);
        const d = await corpo(); const s = String(d.senha || "");
        if (s.length < 6 || s.length > 100) return json({ ok: false, erro: "A senha precisa ter pelo menos 6 caracteres." }, 400);
        st.senhaHash = await Bun.password.hash(s); return json({ ok: true, token: await novaSessao() });
      }
      if (rota === "/api/entrar" && m === "POST") {
        if (!limite("login:" + ipDe(req), 8, 900000)) return json({ ok: false, erro: "Muitas tentativas. Espere 15 minutos." }, 429);
        const d = await corpo();
        if (!st.senhaHash || !(await Bun.password.verify(String(d.senha || ""), st.senhaHash))) return json({ ok: false, erro: "Senha incorreta." }, 401);
        return json({ ok: true, token: await novaSessao() });
      }

      // ----- área protegida -----
      if (rota.startsWith("/api/admin")) {
        if (!autenticado(req)) return json({ ok: false, erro: "Entre com a senha." }, 401);
        if (rota === "/api/admin" && m === "GET") return json({ ok: true, config: st.config, pessoas: st.pessoas, gastos: st.gastos });
        if (rota === "/api/admin/config" && m === "PUT") { st.config = limpaConfig(await corpo()); await salvar(); return json({ ok: true, config: st.config }); }
        if (rota === "/api/admin/senha" && m === "PUT") {
          const d = await corpo(); const s = String(d.senha || "");
          if (s.length < 6 || s.length > 100) return json({ ok: false, erro: "A senha precisa ter pelo menos 6 caracteres." }, 400);
          st.senhaHash = await Bun.password.hash(s); st.sessoes = {}; return json({ ok: true, token: await novaSessao() });
        }
        if (rota === "/api/admin/pessoa" && m === "POST") {
          const d = await corpo(); const nome = txt(d.nome, 60); const faixa = String(d.faixa);
          if (nome.length < 2 || !FAIXAS.includes(faixa)) return json({ ok: false, erro: "Informe o nome e a faixa." }, 400);
          const junto = st.pessoas.find((p: any) => p.id === Number(d.juntoDe));
          const p = { id: st.seq++, familia: junto ? junto.familia : "F" + Date.now().toString(36), nome, faixa, valor: st.config.precos[faixa], pago: false, em: new Date().toISOString() };
          st.pessoas.push(p); await salvar(); return json({ ok: true, pessoa: p });
        }
        const pes = rota.match(/^\/api\/admin\/pessoa\/(\d+)$/);
        if (pes) {
          const i = st.pessoas.findIndex((p: any) => p.id === Number(pes[1]));
          if (i < 0) return json({ ok: false, erro: "Pessoa não encontrada." }, 404);
          if (m === "DELETE") { st.pessoas.splice(i, 1); await salvar(); return json({ ok: true }); }
          if (m === "PATCH") {
            const d = await corpo(); const p = st.pessoas[i];
            if (typeof d.pago === "boolean") p.pago = d.pago;
            if (d.nome !== undefined && txt(d.nome, 60).length >= 2) p.nome = txt(d.nome, 60);
            if (d.faixa !== undefined && FAIXAS.includes(String(d.faixa))) { p.faixa = String(d.faixa); p.valor = st.config.precos[p.faixa]; }
            if (d.valor !== undefined) p.valor = num(d.valor, 0, 10000);
            await salvar(); return json({ ok: true, pessoa: p });
          }
        }
        if (rota === "/api/admin/gastos" && m === "PUT") {
          const d = await corpo();
          st.gastos = lista(d.gastos, 60, g => ({ item: txt(g.item, 80), valor: num(g.valor, 0, 1000000), pago: !!g.pago })).filter(g => g.item);
          await salvar(); return json({ ok: true, gastos: st.gastos });
        }
        if (rota === "/api/admin/foto" && m === "POST") {
          const buf = new Uint8Array(await req.arrayBuffer());
          if (buf.length < 100 || buf.length > 2.5 * 1024 * 1024 || buf[0] !== 0xff || buf[1] !== 0xd8) return json({ ok: false, erro: "Envie uma foto JPG de até 2,5 MB." }, 400);
          const id = crypto.randomUUID(); await Bun.write(`${DIR}/fotos/${id}.jpg`, buf); return json({ ok: true, foto: id });
        }
      }
      return json({ ok: false, erro: "Caminho não encontrado." }, 404);
    } catch (e) { console.error(e); return json({ ok: false, erro: "Erro no servidor." }, 500); }
  },
});
console.log("natal-2026 no ar");
