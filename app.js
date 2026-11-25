const API_URL = 'https://script.google.com/macros/s/AKfycbwXoIcmCCQl13ynmQMvLPP56ldYDNC5sx2hgcgoVIGF1f_CnI74PI82fQAi_7yLMseNag/exec';
const STORAGE_KEY = 'estoque_casa_cache_v1';
const LISTA_LOCAL_KEY = 'estoque_casa_lista_ativa_v1';

function hojeLocal() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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
    state.estimativa_mensal = parsed.estimativa_mensal || 0;
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
  return Number(valorNumerico || 0).toLocaleString('pt-BR', {
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
  const valInicial = Math.max(minVal, Math.min(maxVal, Number(valorInicial || 0)));
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
    state.estimativa_mensal = Number(json.estimativa_mensal || 0);

    const abertas = (json.listas || []).filter(l => l.status === 'ABERTA');
    if (abertas.length > 0 && state.listaAtiva.itens.length === 0) {
      state.listaAtiva = {
        lista_id: abertas[0].lista_id,
        data_prevista: abertas[0].data_prevista,
        itens: abertas.map(l => ({
          item_id: l.item_id,
          nome_avulso: l.nome_avulso,
          qtd_planejada: Number(l.qtd_planejada || 1),
          qtd_comprada: Number(l.qtd_comprada || l.qtd_planejada || 1),
          preco_estimado: Number(l.preco_estimado || 0),
          preco_real: Number(l.preco_real || l.preco_estimado || 0),
          no_carrinho: l.no_carrinho === 'SIM',
          marca: ''
        }))
      };
      salvarListaLocal();
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

// ======================== EVENTOS ========================
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
    <button class="chip ${state.categoriaAtiva === cat ? 'active' : ''}" onclick="filtrarCategoria('${cat}')">${cat}</button>
  `).join('');
}

function renderMercadosSelect(selecionar = '') {
  const sel = document.getElementById('selectLocalMercado');
  const atual = selecionar || sel.value;
  const opcoes = ['<option value="">Selecione o mercado...</option>']
    .concat(state.mercados.map(m => `<option value="${m}">${m}</option>`));
  sel.innerHTML = opcoes.join('');
  if (atual && state.mercados.includes(atual)) sel.value = atual;
}

window.filtrarCategoria = (cat) => {
  state.categoriaAtiva = cat;
  renderCategorias();
  renderDespensa();
};

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
    const atual = Number(it.estoque_atual || 0);
    const min = Number(it.estoque_min || 0);
    const classe = atual < min ? 'alerta-baixo' : (atual === min ? 'alerta-medio' : 'alerta-ok');
    const autonomia = Number(it.autonomia_dias || 0);
    const validadeBadge = getBadgeValidade(it.validade_proxima);

    return `
      <div class="card ${classe}">
        <div class="card-top">
          <div onclick="abrirModalItem('${it.id}')" style="cursor:pointer;flex:1;">
            <div class="card-title">${it.nome}</div>
            <div class="card-meta">${it.categoria} • ${it.unidade_uso} ${it.ultima_marca ? '• ' + it.ultima_marca : ''}</div>
            <div class="badges">
              <span class="badge">Mín: ${min} / Alvo: ${it.estoque_max}</span>
              ${Number(it.ultimo_preco) > 0 ? `<span class="badge">R$ ${formatarCentavosParaTexto(it.ultimo_preco)}</span>` : ''}
              ${autonomia > 0 ? `<span class="badge">~${autonomia} dias</span>` : ''}
              ${validadeBadge}
            </div>
          </div>
          <div class="card-controls">
            <button class="btn-secondary btn-step" onclick="abrirHistorico('${it.id}')" title="Histórico de Preços">📈</button>
            <button class="btn-danger btn-step" onclick="movimentar('${it.id}', 'BAIXA')" title="Dar baixa (-1)">−</button>
            <span class="qtd-pill">${atual}</span>
            <button class="btn-success btn-step" onclick="movimentar('${it.id}', 'ENTRADA')" title="Entrada (+1)">+</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function getBadgeValidade(dataIso) {
  if (!dataIso) return '';
  const diff = Math.ceil((new Date(dataIso) - new Date()) / (1000 * 60 * 60 * 24));
  if (diff <= 3) return `<span class="badge badge-danger">Vence em ${diff}d</span>`;
  if (diff <= 10) return `<span class="badge badge-warn">Val: ${dataIso.slice(5)}</span>`;
  return `<span class="badge">Val: ${dataIso.slice(5)}</span>`;
}

// ======================== AÇÕES DESPENSA ========================
window.movimentar = async (itemId, tipo) => {
  const item = state.itens.find(i => i.id === itemId);
  if (!item) return;

  item.estoque_atual = tipo === 'BAIXA' ? Math.max(0, Number(item.estoque_atual) - 1) : Number(item.estoque_atual) + 1;
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
};

window.abrirModalItem = (id = null) => {
  const selectCat = document.getElementById('itemCategoria');
  selectCat.innerHTML = state.categorias.map(c => `<option value="${c}">${c}</option>`).join('');

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

  criarWheelPicker('wheelAtual', 'atual', item ? item.estoque_atual : 0, 60, 0);
  criarWheelPicker('wheelMin', 'min', item ? item.estoque_min : 1, 30, 0);
  criarWheelPicker('wheelMax', 'max', item ? item.estoque_max : 4, 60, 1);
  criarWheelPicker('wheelFardo', 'fardo', item ? item.qtd_fardo : 1, 30, 1);
};

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
    const atual = Number(it.estoque_atual || 0);
    const min = Number(it.estoque_min || 0);
    const autonomia = Number(it.autonomia_dias || 0);
    if (modo === 'semana') return atual < min || (autonomia > 0 && autonomia <= 7);
    return atual < min;
  });

  if (selecionados.length === 0) {
    alert('Nenhum item precisa de recompletamento nesse filtro.');
    return;
  }

  state.listaAtiva.lista_id = state.listaAtiva.lista_id || ('LST_' + Date.now());
  state.listaAtiva.data_prevista = hojeLocal();

  selecionados.forEach(it => {
    if (!state.listaAtiva.itens.some(x => x.item_id === it.id)) {
      const qtd = Math.max(1, Number(it.estoque_max || 2) - Number(it.estoque_atual || 0));
      state.listaAtiva.itens.push({
        item_id: it.id,
        nome_avulso: '',
        qtd_planejada: qtd,
        qtd_comprada: qtd,
        preco_estimado: Number(it.ultimo_preco || 0),
        preco_real: Number(it.ultimo_preco || 0),
        no_carrinho: false,
        marca: it.ultima_marca || ''
      });
    }
  });

  salvarListaLocal();
  renderListaCompras();
  renderModoMercado();
}

function adicionarAvulso(nome, qtd) {
  state.listaAtiva.lista_id = state.listaAtiva.lista_id || ('LST_' + Date.now());
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
              <div class="card-title">${nome}</div>
              <div class="card-meta">Est.: R$ ${formatarCentavosParaTexto(entry.preco_estimado)} • Sub: R$ ${formatarCentavosParaTexto(sub)}</div>
            </div>
            <div class="card-controls">
              <button class="btn-secondary btn-step" onclick="alterarQtdLista(${idx}, -1)">−</button>
              <span class="qtd-pill">${entry.qtd_planejada}</span>
              <button class="btn-secondary btn-step" onclick="alterarQtdLista(${idx}, 1)">+</button>
              <button class="btn-danger btn-step" onclick="removerDaLista(${idx})">×</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  document.getElementById('totalEstimadoLista').textContent = formatarBRL(totalEst);
  document.getElementById('estimativaMensal').textContent = formatarBRL(state.estimativa_mensal);
}

window.alterarQtdLista = (idx, delta) => {
  const it = state.listaAtiva.itens[idx];
  it.qtd_planejada = Math.max(1, it.qtd_planejada + delta);
  it.qtd_comprada = it.qtd_planejada;
  salvarListaLocal();
  renderListaCompras();
  renderModoMercado();
};

window.removerDaLista = (idx) => {
  state.listaAtiva.itens.splice(idx, 1);
  salvarListaLocal();
  renderListaCompras();
  renderModoMercado();
};

async function salvarListaNaNuvem() {
  try {
    const res = await postGAS({
      action: 'salvarLista',
      lista_id: state.listaAtiva.lista_id || ('LST_' + Date.now()),
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
              <input type="checkbox" ${entry.no_carrinho ? 'checked' : ''} onchange="toggleCarrinho(${idx}, this.checked)" style="width:22px;height:22px;" />
              <div>
                <div class="card-title">${nome}</div>
                <div class="card-meta">Último: R$ ${formatarCentavosParaTexto(entry.preco_estimado)}</div>
              </div>
            </label>
            ${entry.item_id ? `<button class="btn-secondary btn-step" onclick="abrirHistorico('${entry.item_id}')">📈</button>` : ''}
          </div>
          <div class="market-inputs">
            <div class="market-row">
              <button class="btn-secondary btn-step" onclick="updQtdMercado(${idx}, -1)">−</button>
              <span class="qtd-pill">${entry.qtd_comprada}</span>
              <button class="btn-secondary btn-step" onclick="updQtdMercado(${idx}, 1)">+</button>
              <div class="money-wrap" style="flex:1;">
                <span>R$</span>
                <input type="text" inputmode="numeric" id="mPreco${idx}" value="${formatarCentavosParaTexto(entry.preco_real)}" />
              </div>
            </div>
            <input type="text" value="${entry.marca || ''}" onchange="updMercado(${idx}, 'marca', this.value)" placeholder="Marca comprada..." />
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

window.toggleCarrinho = (idx, checked) => {
  state.listaAtiva.itens[idx].no_carrinho = checked;
  salvarListaLocal();
  renderModoMercado();
};

window.updQtdMercado = (idx, delta) => {
  state.listaAtiva.itens[idx].qtd_comprada = Math.max(1, state.listaAtiva.itens[idx].qtd_comprada + delta);
  salvarListaLocal();
  renderModoMercado();
};

window.updMercado = (idx, campo, valor) => {
  state.listaAtiva.itens[idx][campo] = valor;
  salvarListaLocal();
};

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
      lista_id: state.listaAtiva.lista_id || ('LST_' + Date.now()),
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
window.abrirHistorico = (itemId) => {
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
    const precos = hist.map(h => Number(h.preco_unitario));
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
        <span>${h.data_iso} ${h.local_mercado ? '• ' + h.local_mercado : ''} ${h.marca ? '(' + h.marca + ')' : ''}</span>
        <strong>${formatarBRL(Number(h.preco_unitario))}</strong>
      </li>
    `).join('');
  }

  document.getElementById('modalPrecos').showModal();
};

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
    const rolos = Number(document.getElementById('pRolos' + n).value);
    const metros = Number(document.getElementById('pMetros' + n).value);
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
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
