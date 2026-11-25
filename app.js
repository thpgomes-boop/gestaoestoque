const API_URL = 'https://script.google.com/macros/s/AKfycbwXoIcmCCQl13ynmQMvLPP56ldYDNC5sx2hgcgoVIGF1f_CnI74PI82fQAi_7yLMseNag/exec';
const STORAGE_KEY = 'estoque_casa_cache_v1';
const LISTA_LOCAL_KEY = 'estoque_casa_lista_ativa_v1';

function hojeLocal() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function num(v, padrao) {
  const n = Number(v);
  return (v === '' || v === null || v === undefined || isNaN(n)) ? padrao : n;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

function gerarUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

let state = {
  itens: [],
  historicoPrecos: [],
  categorias: [],
  mercados: [],
  estimativa_mensal: 0,
  categoriaAtiva: 'Todas',
  listaAtiva: {
    lista_id: '',
    data_prevista: hojeLocal(),
    itens: []
  }
};

// Guarda os valores atuais dos seletores rotativos (estilo relógio Apple)
const wheelValues = { atual: 0, min: 1, max: 4, fardo: 1 };

// ======================== INICIALIZAÇÃO ========================
document.addEventListener('DOMContentLoaded', () => {
  carregarUsuarioSalvo();
  carregarCacheLocal();
  bindEventos();
  aplicarMascaraBanco(document.getElementById('itemPreco'));
  sincronizarComNuvem();
});

function carregarUsuarioSalvo() {
  const sel = document.getElementById('selectUsuario');
  const salvo = localStorage.getItem('estoque_usuario');
  if (salvo) sel.value = salvo;
  sel.addEventListener('change', () => localStorage.setItem('estoque_usuario', sel.value));
}

function getUsuario() {
  return document.getElementById('selectUsuario').value || 'Casa';
}

function carregarCacheLocal() {
  const cache = localStorage.getItem(STORAGE_KEY);
  if (cache) {
    const parsed = JSON.parse(cache);
    state.itens = parsed.itens || [];
    state.historicoPrecos = parsed.historicoPrecos || [];
    state.categorias = parsed.categorias || [];
    state.mercados = parsed.mercados || [];
    state.estimativa_mensal = num(parsed.estimativa_mensal, 0);
  }
  const listaSalva = localStorage.getItem(LISTA_LOCAL_KEY);
  if (listaSalva) state.listaAtiva = JSON.parse(listaSalva);
  renderTudo();
}

function salvarCacheLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    itens: state.itens,
    historicoPrecos: state.historicoPrecos,
    categorias: state.categorias,
    mercados: state.mercados,
    estimativa_mensal: state.estimativa_mensal
  }));
}

function salvarListaLocal() {
  localStorage.setItem(LISTA_LOCAL_KEY, JSON.stringify(state.listaAtiva));
}

// ======================== MÁSCARA DE PREÇO (APP DE BANCO) ========================
function formatarCentavosParaTexto(valorNumerico) {
  return num(valorNumerico, 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function parseTextoMoeda(texto) {
  const digitos = String(texto || '').replace(/\D/g, '');
  return digitos ? Number(digitos) / 100 : 0;
}

function aplicarMascaraBanco(inputEl, onChangeCallback = null) {
  if (!inputEl) return;
  inputEl.addEventListener('input', () => {
    const valor = parseTextoMoeda(inputEl.value);
    inputEl.value = formatarCentavosParaTexto(valor);
    if (onChangeCallback) onChangeCallback(valor);
  });
}

// ======================== SELETOR ROTATIVO (ESTILO APPLE) ========================
function criarWheelPicker(hostId, keyName, valorInicial = 0, maxVal = 50, minVal = 0) {
  const host = document.getElementById(hostId);
  const itemHeight = 38;
  const valInicial = Math.max(minVal, Math.min(maxVal, num(valorInicial, 0)));
  wheelValues[keyName] = valInicial;

  let itensHtml = '';
  for (let v = minVal; v <= maxVal; v++) {
    itensHtml += `<div class="wheel-item ${v === valInicial ? 'selected' : ''}" data-val="${v}">${v}</div>`;
  }

  host.innerHTML = `
    <div class="wheel-picker">
      <div class="wheel-highlight"></div>
      <div class="wheel-track">${itensHtml}</div>
    </div>
  `;

  const track = host.querySelector('.wheel-track');
  const items = host.querySelectorAll('.wheel-item');

  setTimeout(() => {
    track.scrollTop = (valInicial - minVal) * itemHeight;
  }, 20);

  let scrollTimer;
  track.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const idx = Math.round(track.scrollTop / itemHeight);
      const novoVal = Math.max(minVal, Math.min(maxVal, minVal + idx));
      wheelValues[keyName] = novoVal;
      items.forEach(el => el.classList.toggle('selected', Number(el.dataset.val) === novoVal));
    }, 40);
  });

  items.forEach(el => {
    el.addEventListener('click', () => {
      const v = Number(el.dataset.val);
      track.scrollTo({ top: (v - minVal) * itemHeight, behavior: 'smooth' });
    });
  });
}

// ======================== COMUNICAÇÃO GAS ========================
async function sincronizarComNuvem() {
  setStatus('Sincronizando...');
  try {
    const res = await fetch(API_URL);
    const json = await res.json();
    if (!json.ok) throw new Error(json.erro);

    state.itens = json.itens || [];
    state.historicoPrecos = json.historicoPrecos || [];
    state.categorias = json.categorias || [];
    state.mercados = json.mercados || [];
    state.estimativa_mensal = num(json.estimativa_mensal, 0);

    const todasListas = json.listas || [];

    // 1. Se a lista local já consta como FINALIZADA na nuvem, descarta e avisa
    if (state.listaAtiva.lista_id) {
      const linhasLocaisNaNuvem = todasListas.filter(l => String(l.lista_id) === String(state.listaAtiva.lista_id));
      if (linhasLocaisNaNuvem.length > 0 && linhasLocaisNaNuvem.every(l => l.status === 'FINALIZADA')) {
        state.listaAtiva = { lista_id: '', data_prevista: hojeLocal(), itens: [] };
        salvarListaLocal();
        alert('A lista de compras que estava aberta neste aparelho já foi finalizada em outro dispositivo e foi limpa.');
      }
    }

    // 2. Considera apenas a lista ABERTA mais recente da nuvem
    const todasAbertas = todasListas.filter(l => l.status === 'ABERTA');
    if (todasAbertas.length > 0) {
      const idMaisRecente = todasAbertas[todasAbertas.length - 1].lista_id;
      const abertasRecente = todasAbertas.filter(l => String(l.lista_id) === String(idMaisRecente));

      const listaNuvem = {
        lista_id: idMaisRecente,
        data_prevista: abertasRecente[0].data_prevista || hojeLocal(),
        itens: abertasRecente.map(l => ({
          item_id: l.item_id,
          nome_avulso: l.nome_avulso,
          qtd_planejada: num(l.qtd_planejada, 1),
          qtd_comprada: num(l.qtd_comprada, num(l.qtd_planejada, 1)),
          preco_estimado: num(l.preco_estimado, 0),
          preco_real: num(l.preco_real, num(l.preco_estimado, 0)),
          no_carrinho: l.no_carrinho === 'SIM',
          marca: ''
        }))
      };

      if (state.listaAtiva.itens.length === 0) {
        state.listaAtiva = listaNuvem;
        salvarListaLocal();
      } else if (String(state.listaAtiva.lista_id) !== String(idMaisRecente)) {
        if (confirm('Existe outra lista de compras aberta na nuvem. Deseja carregar a lista da nuvem? (Cancelar mantém a sua lista local)')) {
          state.listaAtiva = listaNuvem;
          salvarListaLocal();
        }
      }
    }

    salvarCacheLocal();
    renderTudo();
    setStatus('Online • Atualizado');
  } catch (err) {
    setStatus('Modo Offline (cache local)');
  }
}

async function postGAS(payload) {
  setStatus('Salvando...');
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.erro || 'Erro ao salvar');
  setStatus('Salvo na nuvem');
  return json.data;
}

function setStatus(txt) {
  document.getElementById('statusSync').textContent = txt;
}

// ======================== EVENTOS (COM DELEGAÇÃO SEGURA) ========================
function bindEventos() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab, .tab-content').forEach(el => el.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });

  document.getElementById('btnSincronizar').addEventListener('click', sincronizarComNuvem);
  document.getElementById('buscaItem').addEventListener('input', renderDespensa);
  document.getElementById('btnNovoItem').addEventListener('click', () => abrirModalItem());
  document.getElementById('formItem').addEventListener('submit', salvarFormItem);

  // Delegação: Categorias
  document.getElementById('listaCategorias').addEventListener('click', e => {
    const btn = e.target.closest('[data-cat]');
    if (btn) filtrarCategoria(btn.dataset.cat);
  });

  // Delegação: Despensa
  document.getElementById('gridDespensa').addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    const id = el.dataset.id;
    if (action === 'editar') abrirModalItem(id);
    else if (action === 'historico') abrirHistorico(id);
    else if (action === 'mov') movimentar(id, el.dataset.tipo);
  });

  // Delegação: Lista de Compras
  document.getElementById('listaComprasContainer').addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const idx = Number(el.dataset.idx);
    if (el.dataset.action === 'qtd-lista') alterarQtdLista(idx, Number(el.dataset.delta));
    else if (el.dataset.action === 'rem-lista') removerDaLista(idx);
  });

  // Delegação: Modo Mercado (cliques e alterações)
  const mercadoEl = document.getElementById('mercadoContainer');
  mercadoEl.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'historico') abrirHistorico(el.dataset.id);
    else if (el.dataset.action === 'qtd-mercado') updQtdMercado(Number(el.dataset.idx), Number(el.dataset.delta));
  });
  mercadoEl.addEventListener('change', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const idx = Number(el.dataset.idx);
    if (el.dataset.action === 'toggle-carrinho') toggleCarrinho(idx, el.checked);
    else if (el.dataset.action === 'marca-mercado') updMercado(idx, 'marca', el.value);
  });

  document.getElementById('btnNovaCategoria').addEventListener('click', async () => {
    const nova = prompt('Nome da nova categoria:');
    if (!nova || !nova.trim()) return;
    try {
      const data = await postGAS({ action: 'adicionarCategoria', categoria: nova.trim() });
      state.categorias = data.categorias;
      salvarCacheLocal();
      renderCategorias();
    } catch (e) { alert('Erro ao adicionar categoria: ' + e.message); }
  });

  document.getElementById('btnNovoMercado').addEventListener('click', async () => {
    const novo = prompt('Nome do novo mercado / atacarejo:');
    if (!novo || !novo.trim()) return;
    try {
      const data = await postGAS({ action: 'adicionarMercado', mercado: novo.trim() });
      state.mercados = data.mercados;
      salvarCacheLocal();
      renderMercadosSelect(novo.trim());
    } catch (e) { alert('Erro ao adicionar mercado: ' + e.message); }
  });

  document.getElementById('btnGerarMinimo').addEventListener('click', () => gerarListaAutomatica('minimo'));
  document.getElementById('btnGerarSemana').addEventListener('click', () => gerarListaAutomatica('semana'));
  document.getElementById('btnSalvarLista').addEventListener('click', salvarListaNaNuvem);

  document.getElementById('btnAddAvulso').addEventListener('click', () => {
    const nome = document.getElementById('inputAvulsoNome').value.trim();
    if (!nome) return;
    adicionarAvulso(nome, 1);
    document.getElementById('inputAvulsoNome').value = '';
  });

  document.getElementById('btnAddMercadoAvulso').addEventListener('click', () => {
    const nome = document.getElementById('inputMercadoAvulso').value.trim();
    if (!nome) return;
    adicionarAvulso(nome, 1);
    document.getElementById('inputMercadoAvulso').value = '';
  });

  document.getElementById('btnFinalizarCompra').addEventListener('click', finalizarCompraMercado);
  document.getElementById('btnCalcPapel').addEventListener('click', abrirCalculadoraPapel);
  document.getElementById('btnLimparPapel').addEventListener('click', renderCalculadoraPapel);
}

// ======================== RENDERIZAÇÃO ========================
function renderTudo() {
  renderCategorias();
  renderMercadosSelect();
  renderDespensa();
  renderListaCompras();
  renderModoMercado();
}

function renderCategorias() {
  const container = document.getElementById('listaCategorias');
  const todas = ['Todas', ...state.categorias];
  container.innerHTML = todas.map(cat => `
    <button class="chip ${state.categoriaAtiva === cat ? 'active' : ''}" data-cat="${esc(cat)}">${esc(cat)}</button>
  `).join('');
}

function renderMercadosSelect(selecionar = '') {
  const sel = document.getElementById('selectLocalMercado');
  const atual = selecionar || sel.value;
  const opcoes = ['<option value="">Selecione o mercado...</option>']
    .concat(state.mercados.map(m => `<option value="${esc(m)}">${esc(m)}</option>`));
  sel.innerHTML = opcoes.join('');
  if (atual && state.mercados.includes(atual)) sel.value = atual;
}

function filtrarCategoria(cat) {
  state.categoriaAtiva = cat;
  renderCategorias();
  renderDespensa();
}

function renderDespensa() {
  const busca = document.getElementById('buscaItem').value.toLowerCase();
  const filtrados = state.itens.filter(it => {
    const matchCat = state.categoriaAtiva === 'Todas' || it.categoria === state.categoriaAtiva;
    const matchBusca = !busca || String(it.nome).toLowerCase().includes(busca);
    return matchCat && matchBusca;
  });

  const grid = document.getElementById('gridDespensa');
  if (filtrados.length === 0) {
    grid.innerHTML = '<div class="card"><p class="hint" style="text-align:center;margin:10px 0;">Nenhum item encontrado. Clique em "+ Item" para começar!</p></div>';
    return;
  }

  grid.innerHTML = filtrados.map(it => {
    const atual = num(it.estoque_atual, 0);
    const min = num(it.estoque_min, 0);
    const classe = atual < min ? 'alerta-baixo' : (atual === min ? 'alerta-medio' : 'alerta-ok');
    const autonomia = num(it.autonomia_dias, 0);
    const validadeBadge = getBadgeValidade(it.validade_proxima);

    return `
      <div class="card ${classe}">
        <div class="card-top">
          <div data-action="editar" data-id="${esc(it.id)}" style="cursor:pointer;flex:1;">
            <div class="card-title">${esc(it.nome)}</div>
            <div class="card-meta">${esc(it.categoria)} • ${esc(it.unidade_uso)} ${it.ultima_marca ? '• ' + esc(it.ultima_marca) : ''}</div>
            <div class="badges">
              <span class="badge">Mín: ${min} / Alvo: ${num(it.estoque_max, 0)}</span>
              ${num(it.ultimo_preco, 0) > 0 ? `<span class="badge">R$ ${formatarCentavosParaTexto(it.ultimo_preco)}</span>` : ''}
              ${autonomia > 0 ? `<span class="badge">~${autonomia} dias</span>` : ''}
              ${validadeBadge}
            </div>
          </div>
          <div class="card-controls">
            <button class="btn-secondary btn-step" data-action="historico" data-id="${esc(it.id)}" title="Histórico de Preços">📈</button>
            <button class="btn-danger btn-step" data-action="mov" data-id="${esc(it.id)}" data-tipo="BAIXA" title="Dar baixa (-1)">−</button>
            <span class="qtd-pill">${atual}</span>
            <button class="btn-success btn-step" data-action="mov" data-id="${esc(it.id)}" data-tipo="ENTRADA" title="Entrada (+1)">+</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function getBadgeValidade(dataIso) {
  if (!dataIso) return '';
  const diff = Math.ceil((new Date(dataIso) - new Date()) / (1000 * 60 * 60 * 24));
  const txtData = esc(String(dataIso).slice(5));
  if (diff <= 3) return `<span class="badge badge-danger">Vence em ${diff}d</span>`;
  if (diff <= 10) return `<span class="badge badge-warn">Val: ${txtData}</span>`;
  return `<span class="badge">Val: ${txtData}</span>`;
}

// ======================== AÇÕES DESPENSA ========================
async function movimentar(itemId, tipo) {
  const item = state.itens.find(i => i.id === itemId);
  if (!item) return;

  item.estoque_atual = tipo === 'BAIXA' ? Math.max(0, num(item.estoque_atual, 0) - 1) : num(item.estoque_atual, 0) + 1;
  salvarCacheLocal();
  renderDespensa();

  try {
    await postGAS({
      action: 'registrarMovimentacao',
      item_id: itemId,
      tipo,
      quantidade: 1,
      usuario: getUsuario()
    });
  } catch (e) {
    alert('Falha ao sincronizar movimentação: ' + e.message);
  }
}

function abrirModalItem(id = null) {
  const selectCat = document.getElementById('itemCategoria');
  selectCat.innerHTML = state.categorias.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');

  const item = id ? state.itens.find(i => i.id === id) : null;
  document.getElementById('modalItemTitulo').textContent = item ? 'Editar Item' : 'Novo Item';
  document.getElementById('itemId').value = item ? item.id : '';
  document.getElementById('itemNome').value = item ? item.nome : '';
  document.getElementById('itemCategoria').value = item ? item.categoria : (state.categorias[0] || 'Alimentos');
  document.getElementById('itemUnidade').value = item ? item.unidade_uso : 'Unidade';
  document.getElementById('itemPreco').value = formatarCentavosParaTexto(item ? item.ultimo_preco : 0);
  document.getElementById('itemMarca').value = item ? item.ultima_marca : '';
  document.getElementById('itemValidade').value = item ? (item.validade_proxima || '') : '';

  document.getElementById('modalItem').showModal();

  criarWheelPicker('wheelAtual', 'atual', item ? num(item.estoque_atual, 0) : 0, 60, 0);
  criarWheelPicker('wheelMin', 'min', item ? num(item.estoque_min, 1) : 1, 30, 0);
  criarWheelPicker('wheelMax', 'max', item ? num(item.estoque_max, 4) : 4, 60, 1);
  criarWheelPicker('wheelFardo', 'fardo', item ? num(item.qtd_fardo, 1) : 1, 30, 1);
}

async function salvarFormItem(e) {
  e.preventDefault();
  const payloadItem = {
    id: document.getElementById('itemId').value || '',
    nome: document.getElementById('itemNome').value.trim(),
    categoria: document.getElementById('itemCategoria').value,
    unidade_uso: document.getElementById('itemUnidade').value,
    estoque_atual: wheelValues.atual,
    estoque_min: wheelValues.min,
    estoque_max: wheelValues.max,
    qtd_fardo: wheelValues.fardo,
    ultimo_preco: parseTextoMoeda(document.getElementById('itemPreco').value),
    ultima_marca: document.getElementById('itemMarca').value.trim(),
    validade_proxima: document.getElementById('itemValidade').value || ''
  };

  document.getElementById('modalItem').close();
  try {
    await postGAS({ action: 'salvarItem', item: payloadItem });
    await sincronizarComNuvem();
  } catch (err) {
    alert('Erro ao salvar item: ' + err.message);
  }
}

// ======================== LISTA & MODO MERCADO ========================
function gerarListaAutomatica(modo) {
  const selecionados = state.itens.filter(it => {
    const atual = num(it.estoque_atual, 0);
    const min = num(it.estoque_min, 0);
    const autonomia = num(it.autonomia_dias, 0);
    if (modo === 'semana') return atual < min || (autonomia > 0 && autonomia <= 7);
    return atual < min;
  });

  if (selecionados.length === 0) {
    alert('Nenhum item precisa de recompletamento nesse filtro.');
    return;
  }

  state.listaAtiva.lista_id = state.listaAtiva.lista_id || ('LST_' + gerarUuid());
  state.listaAtiva.data_prevista = hojeLocal();

  selecionados.forEach(it => {
    if (!state.listaAtiva.itens.some(x => x.item_id === it.id)) {
      const qtd = Math.max(1, num(it.estoque_max, 2) - num(it.estoque_atual, 0));
      state.listaAtiva.itens.push({
        item_id: it.id,
        nome_avulso: '',
        qtd_planejada: qtd,
        qtd_comprada: qtd,
        preco_estimado: num(it.ultimo_preco, 0),
        preco_real: num(it.ultimo_preco, 0),
        no_carrinho: false,
        marca: it.ultima_marca || ''
      });
    }
  });

  salvarListaLocal();
  renderListaCompras();
  renderModoMercado();
  salvarListaSilencioso();
}

function adicionarAvulso(nome, qtd) {
  state.listaAtiva.lista_id = state.listaAtiva.lista_id || ('LST_' + gerarUuid());
  state.listaAtiva.itens.push({
    item_id: '',
    nome_avulso: nome,
    qtd_planejada: qtd,
    qtd_comprada: qtd,
    preco_estimado: 0,
    preco_real: 0,
    no_carrinho: false,
    marca: ''
  });
  salvarListaLocal();
  renderListaCompras();
  renderModoMercado();
  salvarListaSilencioso();
}

function renderListaCompras() {
  const container = document.getElementById('listaComprasContainer');
  let totalEst = 0;

  if (state.listaAtiva.itens.length === 0) {
    container.innerHTML = '<div class="card"><p class="hint" style="text-align:center;margin:10px 0;">Lista vazia. Use "Recompletar" ou adicione um item avulso.</p></div>';
  } else {
    container.innerHTML = state.listaAtiva.itens.map((entry, idx) => {
      const ref = state.itens.find(i => i.id === entry.item_id);
      const nome = ref ? `${ref.nome} (${ref.unidade_uso})` : `${entry.nome_avulso} (Avulso)`;
      const sub = entry.qtd_planejada * entry.preco_estimado;
      totalEst += sub;

      return `
        <div class="card">
          <div class="card-top">
            <div>
              <div class="card-title">${esc(nome)}</div>
              <div class="card-meta">Est.: R$ ${formatarCentavosParaTexto(entry.preco_estimado)} • Sub: R$ ${formatarCentavosParaTexto(sub)}</div>
            </div>
            <div class="card-controls">
              <button class="btn-secondary btn-step" data-action="qtd-lista" data-idx="${idx}" data-delta="-1">−</button>
              <span class="qtd-pill">${entry.qtd_planejada}</span>
              <button class="btn-secondary btn-step" data-action="qtd-lista" data-idx="${idx}" data-delta="1">+</button>
              <button class="btn-danger btn-step" data-action="rem-lista" data-idx="${idx}">×</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  document.getElementById('totalEstimadoLista').textContent = formatarBRL(totalEst);
  document.getElementById('estimativaMensal').textContent = formatarBRL(state.estimativa_mensal);
}

function alterarQtdLista(idx, delta) {
  const it = state.listaAtiva.itens[idx];
  it.qtd_planejada = Math.max(1, it.qtd_planejada + delta);
  it.qtd_comprada = it.qtd_planejada;
  salvarListaLocal();
  renderListaCompras();
  renderModoMercado();
}

function removerDaLista(idx) {
  state.listaAtiva.itens.splice(idx, 1);
  salvarListaLocal();
  renderListaCompras();
  renderModoMercado();
}

async function salvarListaSilencioso() {
  if (!navigator.onLine || state.listaAtiva.itens.length === 0) return;
  try {
    const res = await postGAS({
      action: 'salvarLista',
      lista_id: state.listaAtiva.lista_id || ('LST_' + gerarUuid()),
      data_prevista: state.listaAtiva.data_prevista,
      itensLista: state.listaAtiva.itens
    });
    state.listaAtiva.lista_id = res.lista_id;
    state.estimativa_mensal = res.estimativa_mensal;
    salvarListaLocal();
    salvarCacheLocal();
    renderListaCompras();
  } catch (e) {
    // Silencioso se estiver offline; continua salvo no aparelho
  }
}

async function salvarListaNaNuvem() {
  try {
    const res = await postGAS({
      action: 'salvarLista',
      lista_id: state.listaAtiva.lista_id || ('LST_' + gerarUuid()),
      data_prevista: state.listaAtiva.data_prevista,
      itensLista: state.listaAtiva.itens
    });
    state.listaAtiva.lista_id = res.lista_id;
    state.estimativa_mensal = res.estimativa_mensal;
    salvarListaLocal();
    salvarCacheLocal();
    renderListaCompras();
    alert('Lista salva na nuvem! Estimativa mensal atualizada.');
  } catch (e) {
    alert('Sem conexão. A lista continua salva localmente no seu aparelho.');
  }
}

function renderModoMercado() {
  const container = document.getElementById('mercadoContainer');
  let totalEst = 0;
  let totalCar = 0;

  if (state.listaAtiva.itens.length === 0) {
    container.innerHTML = '<div class="card"><p class="hint" style="text-align:center;margin:10px 0;">Gere ou adicione itens na lista para usar o Modo Mercado.</p></div>';
  } else {
    container.innerHTML = state.listaAtiva.itens.map((entry, idx) => {
      const ref = state.itens.find(i => i.id === entry.item_id);
      const nome = ref ? `${ref.nome} (${ref.unidade_uso})` : `${entry.nome_avulso} (Avulso)`;
      totalEst += entry.qtd_planejada * entry.preco_estimado;
      if (entry.no_carrinho) totalCar += entry.qtd_comprada * entry.preco_real;

      return `
        <div class="card ${entry.no_carrinho ? 'no-carrinho' : ''}">
          <div class="card-top">
            <label style="display:flex;align-items:center;gap:10px;cursor:pointer;flex:1;">
              <input type="checkbox" data-action="toggle-carrinho" data-idx="${idx}" ${entry.no_carrinho ? 'checked' : ''} style="width:22px;height:22px;" />
              <div>
                <div class="card-title">${esc(nome)}</div>
                <div class="card-meta">Último: R$ ${formatarCentavosParaTexto(entry.preco_estimado)}</div>
              </div>
            </label>
            ${entry.item_id ? `<button class="btn-secondary btn-step" data-action="historico" data-id="${esc(entry.item_id)}">📈</button>` : ''}
          </div>
          <div class="market-inputs">
            <div class="market-row">
              <button class="btn-secondary btn-step" data-action="qtd-mercado" data-idx="${idx}" data-delta="-1">−</button>
              <span class="qtd-pill">${entry.qtd_comprada}</span>
              <button class="btn-secondary btn-step" data-action="qtd-mercado" data-idx="${idx}" data-delta="1">+</button>
              <div class="money-wrap" style="flex:1;">
                <span>R$</span>
                <input type="text" inputmode="numeric" id="mPreco${idx}" value="${formatarCentavosParaTexto(entry.preco_real)}" />
              </div>
            </div>
            <input type="text" data-action="marca-mercado" data-idx="${idx}" value="${esc(entry.marca || '')}" placeholder="Marca comprada..." />
          </div>
        </div>
      `;
    }).join('');

    state.listaAtiva.itens.forEach((_, idx) => {
      aplicarMascaraBanco(document.getElementById('mPreco' + idx), (val) => {
        state.listaAtiva.itens[idx].preco_real = val;
        salvarListaLocal();
        atualizarTotaisMercado();
      });
    });
  }

  document.getElementById('totalCarrinho').textContent = formatarBRL(totalCar);
  document.getElementById('totalEstimadoMercado').textContent = formatarBRL(totalEst);
}

function atualizarTotaisMercado() {
  let totalCar = 0;
  state.listaAtiva.itens.forEach(entry => {
    if (entry.no_carrinho) totalCar += entry.qtd_comprada * entry.preco_real;
  });
  document.getElementById('totalCarrinho').textContent = formatarBRL(totalCar);
}

function toggleCarrinho(idx, checked) {
  state.listaAtiva.itens[idx].no_carrinho = checked;
  salvarListaLocal();
  renderModoMercado();
}

function updQtdMercado(idx, delta) {
  state.listaAtiva.itens[idx].qtd_comprada = Math.max(1, state.listaAtiva.itens[idx].qtd_comprada + delta);
  salvarListaLocal();
  renderModoMercado();
}

function updMercado(idx, campo, valor) {
  state.listaAtiva.itens[idx][campo] = valor;
  salvarListaLocal();
}

async function finalizarCompraMercado() {
  const comprados = state.listaAtiva.itens.filter(i => i.no_carrinho);
  if (comprados.length === 0) {
    alert('Marque pelo menos um item no carrinho antes de finalizar.');
    return;
  }
  const local = document.getElementById('selectLocalMercado').value;
  if (!confirm(`Finalizar compra com ${comprados.length} item(ns) e dar entrada no estoque?`)) return;

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

// ======================== CURVA DE PREÇOS (SVG PURO) ========================
function abrirHistorico(itemId) {
  const item = state.itens.find(i => i.id === itemId);
  const hist = state.historicoPrecos
    .filter(h => String(h.item_id) === String(itemId))
    .sort((a, b) => String(a.data_iso).localeCompare(String(b.data_iso)));

  document.getElementById('tituloHistorico').textContent = `📈 Preços: ${item ? item.nome : ''}`;
  const chartBox = document.getElementById('graficoPrecos');
  const ul = document.getElementById('listaHistoricoPrecos');

  if (hist.length === 0) {
    chartBox.innerHTML = '<p class="hint" style="text-align:center;padding:30px 0;">Sem histórico de compras ainda.</p>';
    ul.innerHTML = '';
  } else {
    const precos = hist.map(h => num(h.preco_unitario, 0));
    const min = Math.min(...precos) * 0.95;
    const max = Math.max(...precos) * 1.05 || 1;
    const w = 300, h = 90;
    const pts = precos.map((p, i) => {
      const x = hist.length === 1 ? w / 2 : (i / (hist.length - 1)) * (w - 20) + 10;
      const y = h - ((p - min) / (max - min || 1)) * (h - 20) - 10;
      return `${x},${y}`;
    }).join(' ');

    chartBox.innerHTML = `
      <svg viewBox="0 0 ${w} ${h}" width="100%" height="90">
        <polyline fill="none" stroke="#2563eb" stroke-width="3" points="${pts}" />
        ${precos.map((p, i) => {
          const [x, y] = pts.split(' ')[i].split(',');
          return `<circle cx="${x}" cy="${y}" r="4.5" fill="#16a34a" stroke="#ffffff" stroke-width="1.5" />`;
        }).join('')}
      </svg>
    `;

    ul.innerHTML = [...hist].reverse().map(h => `
      <li>
        <span>${esc(h.data_iso)} ${h.local_mercado ? '• ' + esc(h.local_mercado) : ''} ${h.marca ? '(' + esc(h.marca) + ')' : ''}</span>
        <strong>${formatarBRL(num(h.preco_unitario, 0))}</strong>
      </li>
    `).join('');
  }

  document.getElementById('modalPrecos').showModal();
}

// ======================== CALCULADORA DE PAPEL HIGIÊNICO ========================
function abrirCalculadoraPapel() {
  renderCalculadoraPapel();
  document.getElementById('modalPapel').showModal();
}

function renderCalculadoraPapel() {
  const container = document.getElementById('papelOpcoes');
  container.innerHTML = [1, 2, 3].map(n => `
    <div class="papel-card" id="papelCard${n}">
      <strong>Opção ${n}</strong>
      <div class="money-wrap">
        <span>R$</span>
        <input type="text" inputmode="numeric" id="pPreco${n}" value="0,00" placeholder="Preço" />
      </div>
      <div class="market-row">
        <input type="number" id="pRolos${n}" placeholder="Qtd Rolos" oninput="calcularPapel()" />
        <input type="number" id="pMetros${n}" placeholder="Metros/rolo" oninput="calcularPapel()" />
      </div>
      <div class="quick-m">
        <button type="button" onclick="setMetros(${n}, 20)">20m</button>
        <button type="button" onclick="setMetros(${n}, 30)">30m</button>
        <button type="button" onclick="setMetros(${n}, 60)">60m</button>
      </div>
      <div class="papel-res" id="pRes${n}">Preencha os campos</div>
    </div>
  `).join('');

  [1, 2, 3].forEach(n => {
    aplicarMascaraBanco(document.getElementById('pPreco' + n), calcularPapel);
  });
}

window.setMetros = (n, m) => {
  document.getElementById('pMetros' + n).value = m;
  calcularPapel();
};

window.calcularPapel = () => {
  let melhorN = null;
  let menorCusto = Infinity;

  [1, 2, 3].forEach(n => {
    document.getElementById('papelCard' + n).classList.remove('vencedor');
    const preco = parseTextoMoeda(document.getElementById('pPreco' + n).value);
    const rolos = num(document.getElementById('pRolos' + n).value, 0);
    const metros = num(document.getElementById('pMetros' + n).value, 0);
    const resEl = document.getElementById('pRes' + n);

    if (preco > 0 && rolos > 0 && metros > 0) {
      const totalMetros = rolos * metros;
      const custoMetro = preco / totalMetros;
      resEl.textContent = `R$ ${custoMetro.toFixed(4)} / metro (${totalMetros}m no total)`;
      if (custoMetro < menorCusto) {
        menorCusto = custoMetro;
        melhorN = n;
      }
    } else {
      resEl.textContent = 'Preencha os campos';
    }
  });

  if (melhorN) {
    document.getElementById('papelCard' + melhorN).classList.add('vencedor');
  }
};

function formatarBRL(v) {
  return num(v, 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
