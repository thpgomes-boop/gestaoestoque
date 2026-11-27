const API_URL = 'https://script.google.com/macros/s/AKfycbwXoIcmCCQl13ynmQMvLPP56ldYDNC5sx2hgcgoVIGF1f_CnI74PI82fQAi_7yLMseNag/exec';
const API_TOKEN = '99831900';

const CACHE_KEY = 'estoque_casa_cache_v13';
const LISTA_KEY = 'estoque_casa_lista_v13';
const OUTBOX_KEY = 'estoque_casa_outbox_v13';

const state = {
  itens: [],
  historicoPrecos: [],
  listas: [],
  categorias: [],
  mercados: [],
  financeiro: { estimativa_mensal: 0, realizado: 0, previsto: 0 },
  listaAtiva: { lista_id: '', data_prevista: hojeLocal(), itens: [] },
  busca: '',
  categoriaAtiva: 'Todas',
  filtroVencendo: false,
  mostrarPausados: false,
  modoIA: 'encarte',
  fotoBase64Temp: '',
  fotoIATemp: ''
};

document.addEventListener('DOMContentLoaded', async () => {
  registrarServiceWorker();
  carregarCacheLocal();
  bindEventos();
  renderTudo();
  await processarOutbox();
  await sincronizarComNuvem();
});

function registrarServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

function hojeLocal() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 10);
}

function getUsuario() {
  return document.getElementById('selectUsuario').value || 'Casa';
}

function num(v, padrao) {
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

function normalizarTexto(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function gerarUuid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

function formatarBRL(valor) {
  return num(valor, 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarCentavosParaTexto(valor) {
  const centavos = Math.round(num(valor, 0) * 100);
  return (centavos / 100).toFixed(2).replace('.', ',');
}

function aplicarMascaraBanco(inputEl, onChange) {
  if (!inputEl) return;
  inputEl.addEventListener('input', () => {
    const digitos = inputEl.value.replace(/\D/g, '');
    const cents = parseInt(digitos || '0', 10);
    const reais = cents / 100;
    inputEl.value = reais.toFixed(2).replace('.', ',');
    if (typeof onChange === 'function') onChange(reais);
  });
}

function carregarCacheLocal() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state.itens = parsed.itens || [];
      state.historicoPrecos = parsed.historicoPrecos || [];
      state.listas = parsed.listas || [];
      state.categorias = parsed.categorias || [];
      state.mercados = parsed.mercados || [];
      state.financeiro = parsed.financeiro || { estimativa_mensal: 0, realizado: 0, previsto: 0 };
    }
    const rawLista = localStorage.getItem(LISTA_KEY);
    if (rawLista) {
      state.listaAtiva = JSON.parse(rawLista);
    }
  } catch (e) {}
}

function salvarCacheLocal() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      itens: state.itens,
      historicoPrecos: state.historicoPrecos,
      listas: state.listas,
      categorias: state.categorias,
      mercados: state.mercados,
      financeiro: state.financeiro
    }));
  } catch (e) {}
}

function salvarListaLocal() {
  try {
    localStorage.setItem(LISTA_KEY, JSON.stringify(state.listaAtiva));
  } catch (e) {}
}

function lerOutbox() {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

function salvarOutbox(fila) {
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(fila));
  atualizarStatusConexao();
}

function enfileirar(payload) {
  const fila = lerOutbox();
  if (!payload.op_id) payload.op_id = gerarUuid();
  fila.push(payload);
  salvarOutbox(fila);
  processarOutbox();
}

function atualizarStatusConexao() {
  const pendentes = lerOutbox().length;
  const online = navigator.onLine;
  const dot = document.getElementById('statusDot');
  const txt = document.getElementById('statusSync');
  dot.className = 'status-dot ' + (online ? 'online' : 'offline');
  if (pendentes > 0) {
    txt.textContent = `${online ? 'Online' : 'Offline'} • ${pendentes} pendente(s)`;
  } else {
    txt.textContent = online ? 'Online • Sincronizado' : 'Offline • Modo local';
  }
}

async function postGAS(payload) {
  if (!API_URL || API_URL.startsWith('COLE_AQUI')) {
    throw new Error('Configure a URL do Web App em app.js.');
  }
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({}, payload, { token: API_TOKEN }))
  });
  const json = await resp.json();
  if (!json.ok) throw new Error(json.erro || 'Erro no servidor');
  return json.data;
}

async function processarOutbox() {
  atualizarStatusConexao();
  if (!navigator.onLine) return;
  const fila = lerOutbox();
  if (fila.length === 0) return;

  const restantes = [];
  for (let i = 0; i < fila.length; i++) {
    try {
      await postGAS(fila[i]);
    } catch (e) {
      restantes.push(...fila.slice(i));
      break;
    }
  }
  salvarOutbox(restantes);
}

async function sincronizarComNuvem() {
  atualizarStatusConexao();
  if (!navigator.onLine || !API_URL || API_URL.startsWith('COLE_AQUI')) return;

  try {
    const url = `${API_URL}?action=init&token=${encodeURIComponent(API_TOKEN)}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (!data.ok) return;

    state.itens = data.itens || [];
    state.historicoPrecos = data.historicoPrecos || [];
    state.listas = data.listas || [];
    state.categorias = data.categorias || [];
    state.mercados = data.mercados || [];
    state.financeiro = {
      estimativa_mensal: num(data.estimativa_mensal, 0),
      realizado: num(data.realizado, 0),
      previsto: num(data.previsto, 0)
    };

    if ((!state.listaAtiva.itens || state.listaAtiva.itens.length === 0) && state.listas.length > 0) {
      const primeiraId = state.listas[0].lista_id;
      const linhas = state.listas.filter(l => l.lista_id === primeiraId);
      state.listaAtiva = {
        lista_id: primeiraId,
        data_prevista: linhas[0].data_prevista || hojeLocal(),
        itens: linhas.map(l => ({
          item_id: l.item_id || '',
          nome_avulso: l.nome_avulso || '',
          qtd_planejada: num(l.qtd_planejada, 1),
          qtd_comprada: num(l.qtd_comprada, 0),
          preco_estimado: num(l.preco_estimado, 0),
          preco_real: num(l.preco_real, num(l.preco_estimado, 0)),
          no_carrinho: String(l.no_carrinho).toUpperCase() === 'SIM'
        }))
      };
      salvarListaLocal();
    }

    salvarCacheLocal();
    renderTudo();
  } catch (e) {
    atualizarStatusConexao();
  }
}

function bindEventos() {
  window.addEventListener('online', () => {
    atualizarStatusConexao();
    processarOutbox().then(sincronizarComNuvem);
  });
  window.addEventListener('offline', atualizarStatusConexao);

  document.getElementById('btnSync').addEventListener('click', async () => {
    await processarOutbox();
    await sincronizarComNuvem();
  });

  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'tab-mercado') renderModoMercado();
      if (btn.dataset.tab === 'tab-lista') renderLista();
    });
  });

  document.getElementById('buscaItem').addEventListener('input', e => {
    state.busca = e.target.value;
    renderDespensa();
  });

  document.getElementById('btnFiltroVencendo').addEventListener('click', e => {
    state.filtroVencendo = !state.filtroVencendo;
    e.currentTarget.classList.toggle('ativo', state.filtroVencendo);
    renderDespensa();
  });

  document.getElementById('btnFiltroPausados').addEventListener('click', e => {
    state.mostrarPausados = !state.mostrarPausados;
    e.currentTarget.classList.toggle('btn-pausado-ativo', state.mostrarPausados);
    renderDespensa();
  });

  document.getElementById('btnNovoItem').addEventListener('click', () => abrirModalItem());

  document.getElementById('gridDespensa').addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (action === 'baixar') movimentarItem(id, 'BAIXA', 1);
    else if (action === 'subir') movimentarItem(id, 'ENTRADA', 1);
    else if (action === 'acabou') marcarAcabou(id);
    else if (action === 'estornar') estornarUltimo(id);
    else if (action === 'toggle-ativo') alternarAtivoItem(id);
    else if (action === 'editar') abrirModalItem(id);
    else if (action === 'historico') abrirHistorico(id);
  });

  document.getElementById('btnGerarRecompletar').addEventListener('click', () => gerarListaAutomatica('recompletar'));
  document.getElementById('btnGerarSemana').addEventListener('click', () => gerarListaAutomatica('semana'));
  document.getElementById('btnAddAvulso').addEventListener('click', adicionarItemNaLista);
  document.getElementById('btnSalvarLista').addEventListener('click', salvarListaNoServidor);
  document.getElementById('btnIrMercado').addEventListener('click', () => {
    document.querySelector('.tab[data-tab="tab-mercado"]').click();
  });

  document.getElementById('listaContainer').addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx, 10);
    if (btn.dataset.action === 'qtd-lista') {
      const delta = parseInt(btn.dataset.delta, 10);
      const nova = Math.max(1, num(state.listaAtiva.itens[idx].qtd_planejada, 1) + delta);
      state.listaAtiva.itens[idx].qtd_planejada = nova;
      salvarListaLocal();
      renderLista();
    } else if (btn.dataset.action === 'remover-lista') {
      state.listaAtiva.itens.splice(idx, 1);
      salvarListaLocal();
      renderLista();
    }
  });

  document.getElementById('btnNovoMercado').addEventListener('click', async () => {
    const nome = prompt('Nome do mercado ou local:');
    if (!nome || !nome.trim()) return;
    const limpo = nome.trim();
    if (!state.mercados.includes(limpo)) state.mercados.push(limpo);
    salvarCacheLocal();
    renderSelectMercados(limpo);
    enfileirar({ action: 'adicionarMercado', mercado: limpo });
  });

  document.getElementById('mercadoContainer').addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'qtd-mercado') {
      updQtdMercado(parseInt(btn.dataset.idx, 10), parseInt(btn.dataset.delta, 10));
    } else if (action === 'historico') {
      abrirHistorico(btn.dataset.id);
    }
  });

  document.getElementById('mercadoContainer').addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.action === 'toggle-carrinho') {
      toggleCarrinho(parseInt(el.dataset.idx, 10), el.checked);
    }
  });

  document.getElementById('mercadoContainer').addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.action === 'marca-mercado') {
      updMercado(parseInt(el.dataset.idx, 10), 'marca', el.value);
    }
  });

  document.getElementById('btnFinalizarCompra').addEventListener('click', finalizarCompraMercado);

  // Formulário de Item
  document.getElementById('formItem').addEventListener('submit', salvarFormularioItem);
  aplicarMascaraBanco(document.getElementById('itemPreco'));
  document.getElementById('inputFotoItem').addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    document.getElementById('nomeFotoSelecionada').textContent = file.name;
    comprimirImagem(file, 900, 0.72).then(b64 => { state.fotoBase64Temp = b64; });
  });

  // Modal IA
  document.getElementById('btnAbrirIA').addEventListener('click', () => {
    document.getElementById('resultadoIA').innerHTML = '';
    document.getElementById('modalIA').classList.remove('hidden');
  });
  document.getElementById('modoIAEncarte').addEventListener('click', () => {
    state.modoIA = 'encarte';
    document.getElementById('modoIAEncarte').className = 'btn-primary';
    document.getElementById('modoIACupom').className = 'btn-secondary';
  });
  document.getElementById('modoIACupom').addEventListener('click', () => {
    state.modoIA = 'cupom';
    document.getElementById('modoIACupom').className = 'btn-primary';
    document.getElementById('modoIAEncarte').className = 'btn-secondary';
  });
  document.getElementById('fotoIA').addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    comprimirImagem(file, 1100, 0.75).then(b64 => { state.fotoIATemp = b64; });
  });
  document.getElementById('btnAnalisarIA').addEventListener('click', executarAnaliseIA);

  document.querySelectorAll('[data-fechar]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById(btn.dataset.fechar).classList.add('hidden');
    });
  });
}

function renderTudo() {
  renderFinanceiro();
  renderCategorias();
  renderSelectMercados();
  renderDespensa();
  renderLista();
  renderModoMercado();
}

function renderFinanceiro() {
  document.getElementById('finEstimado').textContent = formatarBRL(state.financeiro.estimativa_mensal);
  document.getElementById('finRealizado').textContent = formatarBRL(state.financeiro.realizado);
  document.getElementById('finPrevisto').textContent = formatarBRL(state.financeiro.previsto);
}

function renderCategorias() {
  const cats = ['Todas', ...(state.categorias || [])];
  const bar = document.getElementById('filtroCategorias');
  bar.innerHTML = cats.map(c => `
    <button class="cat-btn ${state.categoriaAtiva === c ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>
  `).join('');

  bar.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.categoriaAtiva = btn.dataset.cat;
      renderCategorias();
      renderDespensa();
    });
  });

  const sel = document.getElementById('itemCategoria');
  const baseCats = state.categorias && state.categorias.length ? state.categorias : ['Alimentos', 'Higiene', 'Material de limpeza', 'Frios', 'Hortifrúti', 'Carnes/Açougue', 'Bebidas', 'Pet', 'Padaria'];
  sel.innerHTML = baseCats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
}

function renderSelectMercados(selecionar) {
  const sel = document.getElementById('selectLocalMercado');
  const atual = selecionar || sel.value;
  sel.innerHTML = '<option value="">Mercado / Local...</option>' +
    (state.mercados || []).map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  if (atual) sel.value = atual;
}

function renderDespensa() {
  const grid = document.getElementById('gridDespensa');
  const buscaNorm = normalizarTexto(state.busca);
  const hoje = new Date();

  const filtrados = (state.itens || []).filter(it => {
    const isPausado = String(it.ativo || 'SIM').toUpperCase() === 'NAO';
    if (isPausado && !state.mostrarPausados) return false;

    if (state.categoriaAtiva !== 'Todas' && it.categoria !== state.categoriaAtiva) return false;

    if (buscaNorm) {
      const alvo = normalizarTexto(`${it.nome} ${it.categoria} ${it.ultima_marca || ''}`);
      if (!alvo.includes(buscaNorm)) return false;
    }

    if (state.filtroVencendo) {
      if (!it.validade_proxima) return false;
      const diff = Math.ceil((new Date(it.validade_proxima) - hoje) / 86400000);
      if (isNaN(diff) || diff > 7) return false;
    }

    return true;
  });

  if (filtrados.length === 0) {
    grid.innerHTML = '<div class="card"><p class="hint" style="margin:6px 0;">Nenhum item encontrado com os filtros atuais.</p></div>';
    return;
  }

  grid.innerHTML = filtrados.map(it => {
    const isPausado = String(it.ativo || 'SIM').toUpperCase() === 'NAO';
    const atual = num(it.estoque_atual, 0);
    const min = num(it.estoque_min, 0);
    const max = num(it.estoque_max, 0);

    let statusClass = 'status-ok';
    const badges = [];

    if (isPausado) {
      badges.push('<span class="badge badge-muted">Pausado</span>');
    } else if (atual === 0 && min > 0) {
      statusClass = 'status-critico';
      badges.push('<span class="badge badge-danger">Zerado</span>');
    } else if (min > 0 && atual < min) {
      statusClass = 'status-baixo';
      badges.push('<span class="badge badge-warn">Abaixo do mín</span>');
    }

    if (it.autonomia_dias !== '' && it.autonomia_dias !== undefined && it.autonomia_dias !== null) {
      badges.push(`<span class="badge badge-info">~${it.autonomia_dias}d</span>`);
    }

    if (it.validade_proxima) {
      const diff = Math.ceil((new Date(it.validade_proxima) - hoje) / 86400000);
      if (!isNaN(diff) && diff <= 7) {
        statusClass = 'status-baixo';
        badges.push(`<span class="badge badge-warn">Vence ${diff <= 0 ? 'hoje' : diff + 'd'}</span>`);
      }
    }

    if (num(it.ultimo_preco, 0) > 0) {
      badges.push(`<span class="badge badge-ok">${formatarBRL(it.ultimo_preco)}</span>`);
    }

    return `
      <div class="card ${statusClass} ${isPausado ? 'item-pausado' : ''}">
        <div class="card-top">
          <div>
            <div class="card-title">${esc(it.nome)}</div>
            <div class="card-meta">${esc(it.categoria)} • ${esc(it.unidade_uso)}${it.ultima_marca ? ' • ' + esc(it.ultima_marca) : ''}</div>
          </div>
          <div style="display:flex;gap:4px;">
            <button class="btn-secondary btn-step" data-action="historico" data-id="${esc(it.id)}" title="Histórico">📈</button>
            <button class="btn-secondary btn-step" data-action="editar" data-id="${esc(it.id)}" title="Editar">✏️</button>
          </div>
        </div>
        ${badges.length ? `<div class="badges">${badges.join('')}</div>` : ''}
        <div class="card-estoque-linha">
          <div class="estoque-num">
            ${atual} <small>/ alvo ${max} (mín ${min})</small>
          </div>
          <div class="card-acoes">
            <button class="btn-secondary btn-step" data-action="baixar" data-id="${esc(it.id)}" title="Usar 1 unidade">−</button>
            <button class="btn-secondary btn-step" data-action="subir" data-id="${esc(it.id)}" title="Repor 1 unidade">+</button>
            <button class="btn-secondary btn-step" data-action="acabou" data-id="${esc(it.id)}" title="Acabou / Pedir na lista">0</button>
            <button class="btn-secondary btn-step" data-action="estornar" data-id="${esc(it.id)}" title="Desfazer último movimento">↩</button>
            <button class="btn-secondary btn-step" data-action="toggle-ativo" data-id="${esc(it.id)}" title="${isPausado ? 'Reativar item' : 'Pausar item da lista automática'}">${isPausado ? '▶️' : '⏸️'}</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function movimentarItem(itemId, tipo, quantidade) {
  const item = state.itens.find(i => i.id === itemId);
  if (!item) return;
  const atual = num(item.estoque_atual, 0);
  if (tipo === 'BAIXA' && atual <= 0) return;

  item.estoque_atual = tipo === 'BAIXA' ? Math.max(0, atual - quantidade) : atual + quantidade;
  salvarCacheLocal();
  renderDespensa();

  enfileirar({
    action: 'registrarMovimentacao',
    item_id: itemId,
    tipo: tipo,
    quantidade: quantidade,
    usuario: getUsuario(),
    observacao: 'App rápido'
  });
}

function marcarAcabou(itemId) {
  const item = state.itens.find(i => i.id === itemId);
  if (!item) return;
  item.estoque_atual = 0;
  salvarCacheLocal();
  renderDespensa();

  enfileirar({
    action: 'registrarMovimentacao',
    item_id: itemId,
    tipo: 'AJUSTE',
    quantidade: -9999,
    usuario: getUsuario(),
    observacao: 'Marcado como acabou'
  });

  const alvoQtd = Math.max(1, num(item.estoque_max, 1));
  adicionarOuSomarNaLista(item.id, '', alvoQtd, num(item.ultimo_preco, 0));
}

function estornarUltimo(itemId) {
  const item = state.itens.find(i => i.id === itemId);
  if (!item) return;
  item.estoque_atual = num(item.estoque_atual, 0) + 1;
  salvarCacheLocal();
  renderDespensa();

  enfileirar({
    action: 'registrarMovimentacao',
    item_id: itemId,
    tipo: 'ESTORNO',
    quantidade: 1,
    usuario: getUsuario(),
    observacao: 'Estorno rápido'
  });
}

function alternarAtivoItem(itemId) {
  const item = state.itens.find(i => i.id === itemId);
  if (!item) return;
  const estavaPausado = String(item.ativo || 'SIM').toUpperCase() === 'NAO';
  item.ativo = estavaPausado ? 'SIM' : 'NAO';
  salvarCacheLocal();
  renderDespensa();

  enfileirar({
    action: 'alternarAtivoItem',
    item_id: itemId,
    ativo: item.ativo
  });
}

function adicionarOuSomarNaLista(itemId, nomeAvulso, qtd, precoEst) {
  if (!state.listaAtiva.lista_id) {
    state.listaAtiva.lista_id = 'LST_' + Date.now();
  }
  state.listaAtiva.data_prevista = document.getElementById('dataLista').value || hojeLocal();

  const existente = state.listaAtiva.itens.find(i =>
    (itemId && i.item_id === itemId) || (!itemId && nomeAvulso && normalizarTexto(i.nome_avulso) === normalizarTexto(nomeAvulso))
  );

  if (existente) {
    existente.qtd_planejada = num(existente.qtd_planejada, 1) + qtd;
  } else {
    state.listaAtiva.itens.push({
      item_id: itemId || '',
      nome_avulso: nomeAvulso || '',
      qtd_planejada: qtd,
      qtd_comprada: 0,
      preco_estimado: num(precoEst, 0),
      preco_real: num(precoEst, 0),
      no_carrinho: false
    });
  }
  salvarListaLocal();
  renderLista();
}

function gerarListaAutomatica(modo) {
  const novosItens = [];
  (state.itens || []).forEach(it => {
    if (String(it.ativo || 'SIM').toUpperCase() === 'NAO') return;
    const atual = num(it.estoque_atual, 0);
    const min = num(it.estoque_min, 0);
    const max = num(it.estoque_max, 0);

    let precisa = false;
    let qtdSugerida = Math.max(1, max - atual);

    if (modo === 'recompletar') {
      precisa = min > 0 && atual < min;
    } else if (modo === 'semana') {
      const aut = num(it.autonomia_dias, 999);
      precisa = (min > 0 && atual <= min) || (aut <= 7);
    }

    if (precisa && qtdSugerida > 0) {
      novosItens.push({
        item_id: it.id,
        nome_avulso: '',
        qtd_planejada: qtdSugerida,
        qtd_comprada: 0,
        preco_estimado: num(it.ultimo_preco, 0),
        preco_real: num(it.ultimo_preco, 0),
        no_carrinho: false
      });
    }
  });

  if (novosItens.length === 0) {
    alert('Nenhum item ativo precisa ser recomposto agora.');
    return;
  }

  state.listaAtiva = {
    lista_id: state.listaAtiva.lista_id || ('LST_' + Date.now()),
    data_prevista: document.getElementById('dataLista').value || hojeLocal(),
    itens: novosItens
  };
  salvarListaLocal();
  renderLista();
}

function adicionarItemNaLista() {
  const txt = document.getElementById('inputAvulso').value.trim();
  const qtd = Math.max(1, num(document.getElementById('qtdAvulso').value, 1));
  if (!txt) return;

  const match = (state.itens || []).find(i => normalizarTexto(i.nome) === normalizarTexto(txt));
  if (match) {
    adicionarOuSomarNaLista(match.id, '', qtd, num(match.ultimo_preco, 0));
  } else {
    adicionarOuSomarNaLista('', txt, qtd, 0);
  }

  document.getElementById('inputAvulso').value = '';
  document.getElementById('qtdAvulso').value = '1';
}

function renderLista() {
  const dataInput = document.getElementById('dataLista');
  if (!dataInput.value) dataInput.value = state.listaAtiva.data_prevista || hojeLocal();

  const container = document.getElementById('listaContainer');
  if (!state.listaAtiva.itens || state.listaAtiva.itens.length === 0) {
    container.innerHTML = '<div class="card"><p class="hint" style="margin:6px 0;">Sua lista está vazia. Use Recompletar, Semana ou adicione um item.</p></div>';
    return;
  }

  container.innerHTML = state.listaAtiva.itens.map((entry, idx) => {
    const ref = state.itens.find(i => i.id === entry.item_id);
    const titulo = ref ? `${ref.nome} (${ref.unidade_uso})` : `${entry.nome_avulso} (Avulso)`;
    return `
      <div class="card">
        <div class="card-top">
          <div>
            <div class="card-title">${esc(titulo)}</div>
            <div class="card-meta">Est. unitário: ${formatarBRL(entry.preco_estimado)}</div>
          </div>
          <div class="card-acoes">
            <button class="btn-secondary btn-step" data-action="qtd-lista" data-idx="${idx}" data-delta="-1">−</button>
            <strong style="min-width:26px;text-align:center;">${num(entry.qtd_planejada, 1)}</strong>
            <button class="btn-secondary btn-step" data-action="qtd-lista" data-idx="${idx}" data-delta="1">+</button>
            <button class="btn-secondary btn-step" data-action="remover-lista" data-idx="${idx}">🗑</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function salvarListaNoServidor() {
  try {
    const res = await postGAS({
      action: 'salvarLista',
      lista_id: state.listaAtiva.lista_id || ('LST_' + Date.now()),
      data_prevista: document.getElementById('dataLista').value || hojeLocal(),
      itensLista: state.listaAtiva.itens
    });
    if (res) {
      state.financeiro.estimativa_mensal = num(res.estimativa_mensal, state.financeiro.estimativa_mensal);
      state.financeiro.realizado = num(res.realizado, state.financeiro.realizado);
      state.financeiro.previsto = num(res.previsto, state.financeiro.previsto);
      salvarCacheLocal();
      renderFinanceiro();
    }
    alert('Lista salva na nuvem!');
  } catch (e) {
    alert('Não foi possível salvar agora: ' + e.message);
  }
}

function ehItemPorTotal(ref) {
  return !!ref && normalizarTexto(ref.categoria) === 'hortifruti';
}

function formatarProgressoQtd(comprada, planejada) {
  const c = Math.max(0, num(comprada, 0));
  const p = Math.max(0, num(planejada, 0));
  let classeExtra = '';
  if (p > 0 && c === p) classeExtra = 'meta-atingida';
  else if (p > 0 && c > p) classeExtra = 'acima-meta';
  return `<span class="qtd-progresso ${classeExtra}">${c}/${p}</span>`;
}

function getBadgeComparativoPreco(itemId, precoAtual) {
  const p = num(precoAtual, 0);
  if (!itemId || p <= 0) return '';
  const hist = (state.historicoPrecos || []).filter(h => String(h.item_id) === String(itemId) && num(h.preco_unitario, 0) > 0);
  if (hist.length === 0) return '';
  const soma = hist.reduce((acc, h) => acc + num(h.preco_unitario, 0), 0);
  const media = soma / hist.length;
  if (p < media * 0.95) return `<span class="badge badge-ok">Abaixo da média (${formatarBRL(media)})</span>`;
  if (p > media * 1.05) return `<span class="badge badge-danger">Acima da média (${formatarBRL(media)})</span>`;
  return `<span class="badge badge-info">Na média (${formatarBRL(media)})</span>`;
}

function renderModoMercado() {
  const container = document.getElementById('mercadoContainer');
  let totalEst = 0;
  let totalCar = 0;

  if (!state.listaAtiva.itens || state.listaAtiva.itens.length === 0) {
    container.innerHTML = '<div class="card"><p class="hint" style="text-align:center;margin:10px 0;">Gere ou adicione itens na lista para usar o Modo Mercado.</p></div>';
  } else {
    const grupos = {};
    state.listaAtiva.itens.forEach((entry, idx) => {
      const ref = state.itens.find(i => i.id === entry.item_id);
      const cat = ref ? (ref.categoria || 'Outros') : 'Avulsos';
      if (!grupos[cat]) grupos[cat] = [];
      grupos[cat].push({ entry, idx, ref });

      const qtdPlan = num(entry.qtd_planejada, 0);
      const qtdComp = Math.max(0, num(entry.qtd_comprada, 0));
      const porTotal = ehItemPorTotal(ref);

      totalEst += qtdPlan * num(entry.preco_estimado, 0);
      if (entry.no_carrinho && qtdComp > 0) {
        totalCar += porTotal ? num(entry.preco_real, 0) : (qtdComp * num(entry.preco_real, 0));
      }
    });

    const htmlPartes = [];
    Object.keys(grupos).sort().forEach(cat => {
      htmlPartes.push(`<div class="grupo-corredor">${esc(cat)}</div>`);
      grupos[cat].forEach(({ entry, idx, ref }) => {
        const nome = ref ? `${ref.nome} (${ref.unidade_uso})` : `${entry.nome_avulso} (Avulso)`;
        const qtdComp = Math.max(0, num(entry.qtd_comprada, 0));
        const qtdPlan = Math.max(0, num(entry.qtd_planejada, 0));
        const porTotal = ehItemPorTotal(ref);
        const precoUnitComparacao = (porTotal && qtdComp > 0) ? (num(entry.preco_real, 0) / qtdComp) : num(entry.preco_real, 0);
        const badgeComp = getBadgeComparativoPreco(entry.item_id, precoUnitComparacao);

        const subLinhaMeta = porTotal
          ? `Último: R$ ${formatarCentavosParaTexto(entry.preco_estimado)}/un • Digite o TOTAL pago${qtdComp > 0 ? ` (~R$ ${formatarCentavosParaTexto(precoUnitComparacao)}/un)` : ''}`
          : `Último: R$ ${formatarCentavosParaTexto(entry.preco_estimado)} • Meta: ${qtdPlan}`;

        htmlPartes.push(`
          <div class="card ${entry.no_carrinho && qtdComp > 0 ? 'no-carrinho' : ''}">
            <div class="card-top">
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer;flex:1;">
                <input type="checkbox" data-action="toggle-carrinho" data-idx="${idx}" ${entry.no_carrinho && qtdComp > 0 ? 'checked' : ''} style="width:22px;height:22px;" />
                <div>
                  <div class="card-title">${esc(nome)}</div>
                  <div class="card-meta" id="metaMercado${idx}">${subLinhaMeta}</div>
                  <div class="badges" id="badgeComp${idx}">${badgeComp}</div>
                </div>
              </label>
              ${entry.item_id ? `<button class="btn-secondary btn-step" data-action="historico" data-id="${esc(entry.item_id)}">📈</button>` : ''}
            </div>
            <div class="market-inputs">
              <div class="market-row">
                <button class="btn-secondary btn-step" data-action="qtd-mercado" data-idx="${idx}" data-delta="-1">−</button>
                ${formatarProgressoQtd(qtdComp, qtdPlan)}
                <button class="btn-secondary btn-step" data-action="qtd-mercado" data-idx="${idx}" data-delta="1">+</button>
                <div class="money-wrap" style="flex:1;">
                  <span>R$</span>
                  <input type="text" inputmode="numeric" id="mPreco${idx}" value="${formatarCentavosParaTexto(entry.preco_real)}" title="${porTotal ? 'Valor total pago' : 'Preço unitário'}" />
                </div>
              </div>
              <input type="text" data-action="marca-mercado" data-idx="${idx}" value="${esc(entry.marca || '')}" placeholder="Marca comprada..." />
            </div>
          </div>
        `);
      });
    });

    container.innerHTML = htmlPartes.join('');

    state.listaAtiva.itens.forEach((entry, idx) => {
      const ref = state.itens.find(i => i.id === entry.item_id);
      const porTotal = ehItemPorTotal(ref);

      aplicarMascaraBanco(document.getElementById('mPreco' + idx), (val) => {
        state.listaAtiva.itens[idx].preco_real = val;
        salvarListaLocal();
        atualizarTotaisMercado();

        const qtdComp = Math.max(0, num(state.listaAtiva.itens[idx].qtd_comprada, 0));
        const precoUnit = (porTotal && qtdComp > 0) ? (val / qtdComp) : val;

        if (porTotal) {
          const metaEl = document.getElementById('metaMercado' + idx);
          if (metaEl) {
            metaEl.textContent = `Último: R$ ${formatarCentavosParaTexto(entry.preco_estimado)}/un • Digite o TOTAL pago${qtdComp > 0 ? ` (~R$ ${formatarCentavosParaTexto(precoUnit)}/un)` : ''}`;
          }
        }

        const badgeEl = document.getElementById('badgeComp' + idx);
        if (badgeEl) badgeEl.innerHTML = getBadgeComparativoPreco(entry.item_id, precoUnit);
      });
    });
  }

  document.getElementById('totalCarrinho').textContent = formatarBRL(totalCar);
  document.getElementById('totalEstimadoMercado').textContent = formatarBRL(totalEst);
}

function atualizarTotaisMercado() {
  let totalCar = 0;
  state.listaAtiva.itens.forEach(entry => {
    const qtdComp = Math.max(0, num(entry.qtd_comprada, 0));
    if (entry.no_carrinho && qtdComp > 0) {
      const ref = state.itens.find(i => i.id === entry.item_id);
      const porTotal = ehItemPorTotal(ref);
      totalCar += porTotal ? num(entry.preco_real, 0) : (qtdComp * num(entry.preco_real, 0));
    }
  });
  document.getElementById('totalCarrinho').textContent = formatarBRL(totalCar);
}

function toggleCarrinho(idx, checked) {
  const item = state.listaAtiva.itens[idx];
  if (!item) return;
  if (checked && Math.max(0, num(item.qtd_comprada, 0)) === 0) {
    item.qtd_comprada = Math.max(1, num(item.qtd_planejada, 1));
  }
  item.no_carrinho = checked;
  salvarListaLocal();
  renderModoMercado();
}

function updQtdMercado(idx, delta) {
  const item = state.listaAtiva.itens[idx];
  if (!item) return;
  const atual = Math.max(0, num(item.qtd_comprada, 0));
  const novaQtd = Math.max(0, atual + delta);
  item.qtd_comprada = novaQtd;

  if (novaQtd === 0) {
    item.no_carrinho = false;
  } else if (delta > 0 && atual === 0) {
    item.no_carrinho = true;
  }

  salvarListaLocal();
  renderModoMercado();
}

function updMercado(idx, campo, valor) {
  state.listaAtiva.itens[idx][campo] = valor;
  salvarListaLocal();
}

async function finalizarCompraMercado() {
  const selecionados = state.listaAtiva.itens.filter(i => i.no_carrinho && Math.max(0, num(i.qtd_comprada, 0)) > 0);
  if (selecionados.length === 0) {
    alert('Adicione quantidade (> 0) e marque pelo menos um item no carrinho antes de finalizar.');
    return;
  }
  const local = document.getElementById('selectLocalMercado').value;
  if (!confirm(`Finalizar compra com ${selecionados.length} item(ns) e dar entrada no estoque?`)) return;

  const comprados = selecionados.map(entry => {
    const ref = state.itens.find(i => i.id === entry.item_id);
    const qtd = Math.max(0, num(entry.qtd_comprada, 0));
    const preco = num(entry.preco_real, 0);
    if (ehItemPorTotal(ref) && qtd > 0 && preco > 0) {
      return Object.assign({}, entry, {
        preco_real: Number((preco / qtd).toFixed(2))
      });
    }
    return entry;
  });

  try {
    await postGAS({
      action: 'finalizarCompra',
      lista_id: state.listaAtiva.lista_id || ('LST_' + gerarUuid()),
      local_mercado: local,
      usuario: getUsuario(),
      itensComprados: comprados
    });
    state.listaAtiva = { lista_id: '', data_prevista: hojeLocal(), itens: [] };
    salvarListaLocal();
    await sincronizarComNuvem();
    alert('Compra finalizada! Estoque e histórico de preços atualizados.');
  } catch (e) {
    alert('Erro ao finalizar (verifique sua internet): ' + e.message);
  }
}

function abrirModalItem(itemId) {
  state.fotoBase64Temp = '';
  document.getElementById('nomeFotoSelecionada').textContent = 'Nenhuma foto nova';
  const ref = itemId ? state.itens.find(i => i.id === itemId) : null;

  document.getElementById('modalItemTitulo').textContent = ref ? 'Editar item' : 'Novo item';
  document.getElementById('itemId').value = ref ? ref.id : '';
  document.getElementById('itemNome').value = ref ? ref.nome : '';
  if (ref && ref.categoria) document.getElementById('itemCategoria').value = ref.categoria;
  document.getElementById('itemUnidade').value = ref ? ref.unidade_uso : 'Unidade';
  document.getElementById('itemAtual').value = ref ? num(ref.estoque_atual, 0) : 0;
  document.getElementById('itemMin').value = ref ? num(ref.estoque_min, 1) : 1;
  document.getElementById('itemMax').value = ref ? num(ref.estoque_max, 2) : 2;
  document.getElementById('itemFardo').value = ref ? num(ref.qtd_fardo, 1) : 1;
  document.getElementById('itemPreco').value = formatarCentavosParaTexto(ref ? ref.ultimo_preco : 0);
  document.getElementById('itemMarca').value = ref ? (ref.ultima_marca || '') : '';
  document.getElementById('itemValidade').value = ref ? (ref.validade_proxima || '') : '';
  document.getElementById('itemAtivo').checked = ref ? String(ref.ativo || 'SIM').toUpperCase() !== 'NAO' : true;

  document.getElementById('modalItem').classList.remove('hidden');
}

async function salvarFormularioItem(e) {
  e.preventDefault();
  const precoDigits = document.getElementById('itemPreco').value.replace(/\D/g, '');
  const precoVal = (parseInt(precoDigits || '0', 10)) / 100;

  const itemObj = {
    id: document.getElementById('itemId').value || ('IT_' + gerarUuid()),
    nome: document.getElementById('itemNome').value.trim(),
    categoria: document.getElementById('itemCategoria').value,
    unidade_uso: document.getElementById('itemUnidade').value.trim() || 'Unidade',
    estoque_atual: num(document.getElementById('itemAtual').value, 0),
    estoque_min: num(document.getElementById('itemMin').value, 0),
    estoque_max: num(document.getElementById('itemMax').value, 1),
    qtd_fardo: num(document.getElementById('itemFardo').value, 1),
    ultimo_preco: precoVal,
    ultima_marca: document.getElementById('itemMarca').value.trim(),
    validade_proxima: document.getElementById('itemValidade').value,
    ativo: document.getElementById('itemAtivo').checked ? 'SIM' : 'NAO'
  };

  const idxExistente = state.itens.findIndex(i => i.id === itemObj.id);
  if (idxExistente > -1) {
    state.itens[idxExistente] = Object.assign({}, state.itens[idxExistente], itemObj);
  } else {
    state.itens.push(itemObj);
  }

  salvarCacheLocal();
  renderDespensa();
  document.getElementById('modalItem').classList.add('hidden');

  enfileirar({ action: 'salvarItem', item: itemObj });

  if (state.fotoBase64Temp && navigator.onLine) {
    try {
      await postGAS({ action: 'uploadFoto', item_id: itemObj.id, imagemBase64: state.fotoBase64Temp });
    } catch (err) {}
  }
}

async function abrirHistorico(itemId) {
  const ref = state.itens.find(i => i.id === itemId);
  document.getElementById('tituloHistorico').textContent = `Preços • ${ref ? ref.nome : itemId}`;
  const box = document.getElementById('conteudoHistorico');
  box.innerHTML = '<p class="hint">Carregando histórico...</p>';
  document.getElementById('modalHistorico').classList.remove('hidden');

  let registros = (state.historicoPrecos || []).filter(p => String(p.item_id) === String(itemId));
  if (navigator.onLine && API_URL && !API_URL.startsWith('COLE_AQUI')) {
    try {
      const r = await fetch(`${API_URL}?action=historicoItem&id=${encodeURIComponent(itemId)}&token=${encodeURIComponent(API_TOKEN)}`);
      const j = await r.json();
      if (j.ok && Array.isArray(j.historicoPrecos)) registros = j.historicoPrecos;
    } catch (e) {}
  }

  if (registros.length === 0) {
    box.innerHTML = '<p class="hint">Ainda não há registros de preço para este item.</p>';
    return;
  }

  box.innerHTML = registros.slice().reverse().map(r => `
    <div class="card" style="margin-bottom:8px;">
      <div class="card-title">${formatarBRL(r.preco_unitario)} ${r.local_mercado ? '• ' + esc(r.local_mercado) : ''}</div>
      <div class="card-meta">${esc(r.data_iso)} ${r.marca ? '• ' + esc(r.marca) : ''}</div>
    </div>
  `).join('');
}

async function executarAnaliseIA() {
  const texto = document.getElementById('textoIA').value.trim();
  const resBox = document.getElementById('resultadoIA');
  if (!texto && !state.fotoIATemp) {
    alert('Envie um texto ou foto primeiro.');
    return;
  }
  resBox.innerHTML = '<p class="hint">Analisando com IA...</p>';

  try {
    const data = await postGAS({
      action: 'analisarComIA',
      modo: state.modoIA,
      texto: texto,
      imagemBase64: state.fotoIATemp
    });

    const listaIA = data.itens || [];
    if (listaIA.length === 0) {
      resBox.innerHTML = '<p class="hint">Nenhum item identificado.</p>';
      return;
    }

    resBox.innerHTML = listaIA.map((it, idx) => `
      <div class="card">
        <div class="card-top">
          <div>
            <div class="card-title">${esc(it.nome)}</div>
            <div class="card-meta">${formatarBRL(it.preco)} • Qtd: ${num(it.quantidade, 1)} ${it.marca ? '• ' + esc(it.marca) : ''}</div>
          </div>
          <button type="button" class="btn-primary btn-add-ia" data-ia-idx="${idx}">+ Lista</button>
        </div>
      </div>
    `).join('');

    resBox.querySelectorAll('.btn-add-ia').forEach(btn => {
      btn.addEventListener('click', () => {
        const itemIA = listaIA[parseInt(btn.dataset.iaIdx, 10)];
        if (!itemIA) return;
        const ref = (state.itens || []).find(i => normalizarTexto(i.nome).includes(normalizarTexto(itemIA.nome)) || normalizarTexto(itemIA.nome).includes(normalizarTexto(i.nome)));
        adicionarOuSomarNaLista(ref ? ref.id : '', ref ? '' : itemIA.nome, Math.max(1, num(itemIA.quantidade, 1)), num(itemIA.preco, 0));
        btn.textContent = '✓ Na lista';
        btn.disabled = true;
      });
    });
  } catch (e) {
    resBox.innerHTML = `<p class="hint" style="color:var(--danger);">${esc(e.message)}</p>`;
  }
}

function comprimirImagem(file, maxDim, qualidade) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
          else { w = Math.round((w * maxDim) / h); h = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', qualidade));
      };
      img.onerror = reject;
      img.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
