const CONFIG_APP = {
  GAS_URL: 'https://script.google.com/macros/s/AKfycbwXoIcmCCQl13ynmQMvLPP56ldYDNC5sx2hgcgoVIGF1f_CnI74PI82fQAi_7yLMseNag/exec',
  API_TOKEN: '99831900',
  CACHE_KEY: 'estoque_casa_cache_v1',
  LISTA_KEY: 'estoque_casa_lista_v1',
  OUTBOX_KEY: 'estoque_casa_outbox_v1',
  USUARIO_KEY: 'estoque_casa_usuario_v1'
};

const state = {
  itens: [],
  historicoPrecos: [],
  listasFinalizadasIds: [],
  categorias: ['Material de limpeza', 'Higiene', 'Alimentos', 'Frios', 'Hortifrúti', 'Carnes/Açougue', 'Bebidas', 'Pet', 'Padaria'],
  mercados: [],
  categoriaSelecionada: 'Todas',
  busca: '',
  filtroVencendo: false,
  mostrarPausados: false,
  estimativaMensal: 0,
  realizadoMes: 0,
  previstoMes: 0,
  listaAtiva: { lista_id: '', data_prevista: hojeLocal(), itens: [] },
  outbox: [],
  ultimoEstorno: null,
  modoIA: 'encarte'
};

document.addEventListener('DOMContentLoaded', async () => {
  carregarUsuario();
  carregarCacheLocal();
  renderTudo();
  bindEventos();
  await sincronizarComNuvem();
});

function hojeLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function gerarUuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

function num(v, padrao = 0) {
  const n = Number(v);
  return (v === '' || v === null || v === undefined || isNaN(n)) ? padrao : n;
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizarTexto(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function formatarBRL(valor) {
  return num(valor, 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarCentavosParaTexto(valor) {
  return num(valor, 0).toFixed(2).replace('.', ',');
}

function aplicarMascaraBanco(inputEl, onChangeCallback) {
  if (!inputEl) return;
  inputEl.addEventListener('input', () => {
    const digitos = inputEl.value.replace(/\D/g, '');
    const centavos = parseInt(digitos || '0', 10);
    const reais = centavos / 100;
    inputEl.value = formatarCentavosParaTexto(reais);
    if (typeof onChangeCallback === 'function') onChangeCallback(reais);
  });
}

function ehItemPorTotal(ref) {
  return !!ref && normalizarTexto(ref.categoria) === 'hortifruti';
}

function carregarUsuario() {
  const salvo = localStorage.getItem(CONFIG_APP.USUARIO_KEY) || 'Thiago';
  const sel = document.getElementById('selectUsuario');
  if (sel) sel.value = salvo;
}

function getUsuario() {
  return document.getElementById('selectUsuario')?.value || 'Thiago';
}

function carregarCacheLocal() {
  try {
    const raw = localStorage.getItem(CONFIG_APP.CACHE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      state.itens = data.itens || [];
      state.historicoPrecos = data.historicoPrecos || [];
      state.listasFinalizadasIds = data.listasFinalizadasIds || [];
      if (Array.isArray(data.categorias) && data.categorias.length) state.categorias = data.categorias;
      if (Array.isArray(data.mercados)) state.mercados = data.mercados;
      state.estimativaMensal = num(data.estimativaMensal, 0);
      state.realizadoMes = num(data.realizadoMes, 0);
      state.previstoMes = num(data.previstoMes, 0);
    }
    const listaRaw = localStorage.getItem(CONFIG_APP.LISTA_KEY);
    if (listaRaw) state.listaAtiva = JSON.parse(listaRaw);

    const outRaw = localStorage.getItem(CONFIG_APP.OUTBOX_KEY);
    if (outRaw) state.outbox = JSON.parse(outRaw);
  } catch (e) {
    console.warn('Erro ao ler cache local:', e);
  }
}

function salvarCacheLocal() {
  localStorage.setItem(CONFIG_APP.CACHE_KEY, JSON.stringify({
    itens: state.itens,
    historicoPrecos: state.historicoPrecos,
    listasFinalizadasIds: state.listasFinalizadasIds,
    categorias: state.categorias,
    mercados: state.mercados,
    estimativaMensal: state.estimativaMensal,
    realizadoMes: state.realizadoMes,
    previstoMes: state.previstoMes
  }));
}

function salvarListaLocal() {
  localStorage.setItem(CONFIG_APP.LISTA_KEY, JSON.stringify(state.listaAtiva));
}

function salvarOutbox() {
  localStorage.setItem(CONFIG_APP.OUTBOX_KEY, JSON.stringify(state.outbox));
  atualizarBadgeStatus();
}

function atualizarBadgeStatus() {
  const badge = document.getElementById('statusSync');
  if (!badge) return;
  const pendentes = state.outbox.length;
  if (!navigator.onLine) {
    badge.textContent = pendentes > 0 ? `Offline • ${pendentes} pendente(s)` : 'Offline';
    badge.classList.add('offline');
  } else {
    badge.textContent = pendentes > 0 ? `Online • ${pendentes} pendente(s)` : 'Online • Atualizado';
    badge.classList.remove('offline');
  }
}

async function getGAS(params = {}) {
  const url = new URL(CONFIG_APP.GAS_URL);
  url.searchParams.set('token', CONFIG_APP.API_TOKEN);
  Object.keys(params).forEach(k => url.searchParams.set(k, params[k]));
  const resp = await fetch(url.toString(), { method: 'GET' });
  const json = await resp.json();
  if (!json.ok) throw new Error(json.erro || 'Erro na resposta do servidor');
  return json;
}

async function postGAS(payload) {
  const body = Object.assign({}, payload, { token: CONFIG_APP.API_TOKEN });
  const resp = await fetch(CONFIG_APP.GAS_URL, {
    method: 'POST',
