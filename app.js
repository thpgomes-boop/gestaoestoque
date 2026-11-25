const API_URL = 'https://script.google.com/macros/s/AKfycbwXoIcmCCQl13ynmQMvLPP56ldYDNC5sx2hgcgoVIGF1f_CnI74PI82fQAi_7yLMseNag/exec';
const STORAGE_KEY = 'estoque_casa_cache_v1';
const LISTA_LOCAL_KEY = 'estoque_casa_lista_ativa_v1';

let state = {
  itens: [],
  historicoPrecos: [],
  categorias: [],
  estimativa_mensal: 0,
  categoriaAtiva: 'Todas',
  listaAtiva: {
    lista_id: '',
    data_prevista: new Date().toISOString().slice(0, 10),
    itens: []
  }
};

// ======================== INICIALIZAÇÃO ========================
document.addEventListener('DOMContentLoaded', () => {
  carregarUsuarioSalvo();
  carregarCacheLocal();
  bindEventos();
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
    state.estimativa_mensal = parsed.estimativa_mensal || 0;
  }
  const listaSalva = localStorage.getItem(LISTA_LOCAL_KEY);
  if (listaSalva) {
    state.listaAtiva = JSON.parse(listaSalva);
  }
  renderTudo();
}

function salvarCacheLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    itens: state.itens,
    historicoPrecos: state.historicoPrecos,
    categorias: state.categorias,
    estimativa_mensal: state.estimativa_mensal
  }));
}

function salvarListaLocal() {
  localStorage.setItem(LISTA_LOCAL_KEY, JSON.stringify(state.listaAtiva));
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
    state.estimativa_mensal = Number(json.estimativa_mensal || 0);

    // Carrega lista ABERTA da nuvem se não houver alterações locais em andamento
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
  // Navegação de abas
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

  document.getElementById('btnGerarMinimo').addEventListener('click', () => gerarListaAutomatica('minimo'));
  document.getElementById('btnGerarSemana').addEventListener('click', () => gerarListaAutomatica('semana'));
  document.getElementById('btnSalvarLista').addEventListener('click', salvarListaNaNuvem);

  document.getElementById('btnAddAvulso').addEventListener('click', () => {
    const nome = document.getElementById('inputAvulsoNome').value.trim();
    const qtd = Number(document.getElementById('inputAvulsoQtd').value || 1);
    if (!nome) return;
    adicionarAvulso(nome, qtd);
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
    grid.innerHTML = '<p class="hint" style="text-align:center;padding:20px;">Nenhum item encontrado. Clique em "+ Item" para começar.</p>';
    return;
  }

  grid.innerHTML = filtrados.map(it => {
    const atual = Number(it.estoque_atual || 0);
    const min = Number(it.estoque_min || 0);
    const classe = atual <= min ? 'alerta-baixo' : (atual <= min + 1 ? 'alerta-medio' : 'alerta-ok');
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
              ${Number(it.ultimo_preco) > 0 ? `<span class="badge">R$ ${Number(it.ultimo_preco).toFixed(2)}</span>` : ''}
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

  // Atualização otimista na tela (resposta imediata)
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
  document.getElementById('itemAtual').value = item ? item.estoque_atual : 0;
  document.getElementById('itemMin').value = item ? item.estoque_min : 1;
  document.getElementById('itemMax').value = item ? item.estoque_max : 4;
  document.getElementById('itemFardo').value = item ? item.qtd_fardo : 1;
  document.getElementById('itemPreco').value = item ? item.ultimo_preco : 0;
  document.getElementById('itemMarca').value = item ? item.ultima_marca : '';
  document.getElementById('itemValidade').value = item ? (item.validade_proxima || '') : '';

  document.getElementById('modalItem').showModal();
};

async function salvarFormItem(e) {
  e.preventDefault();
  const payloadItem = {
    id: document.getElementById('itemId').value || '',
    nome: document.getElementById('itemNome').value.trim(),
    categoria: document.getElementById('itemCategoria').value,
    unidade_uso: document.getElementById('itemUnidade').value.trim(),
    estoque_atual: Number(document.getElementById('itemAtual').value),
    estoque_min: Number(document.getElementById('itemMin').value),
    estoque_max: Number(document.getElementById('itemMax').value),
    qtd_fardo: Number(document.getElementById('itemFardo').value || 1),
    ultimo_preco: Number(document.getElementById('itemPreco').value || 0),
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
    if (modo === 'semana') {
      return atual <= min || (autonomia > 0 && autonomia <= 7);
    }
    return atual <= min;
  });

  if (selecionados.length === 0) {
    alert('Nenhum item precisa de recompletamento nesse filtro.');
    return;
  }

  state.listaAtiva.lista_id = state.listaAtiva.lista_id || ('LST_' + Date.now());
  state.listaAtiva.data_prevista = new Date().toISOString().slice(0, 10);

  selecionados.forEach(it => {
    const jaExiste = state.listaAtiva.itens.some(x => x.item_id === it.id);
    if (!jaExiste) {
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
    container.innerHTML = '<p class="hint" style="text-align:center;padding:20px;">Lista vazia. Use "Recompletar" ou adicione um item avulso.</p>';
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
              <div class="card-meta">Est.: R$ ${entry.preco_estimado.toFixed(2)} • Subtotal: R$ ${sub.toFixed(2)}</div>
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
    container.innerHTML = '<p class="hint" style="text-align:center;padding:20px;">Gere ou adicione itens na lista para usar o Modo Mercado.</p>';
  } else {
    container.innerHTML = state.listaAtiva.itens.map((entry, idx) => {
      const ref = state.itens.find(i => i.id === entry.item_id);
      const nome = ref ? `${ref.nome} (${ref.unidade_uso})` : `${entry.nome_avulso} (Avulso)`;
      totalEst += entry.qtd_planejada * entry.preco_estimado;
      if (entry.no_carrinho) totalCar += entry.qtd_comprada * entry.preco_real;

      return `
        <div class="card ${entry.no_carrinho ? 'no-carrinho' : ''}">
          <div class="card-top">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;flex:1;">
              <input type="checkbox" ${entry.no_carrinho ? 'checked' : ''} onchange="toggleCarrinho(${idx}, this.checked)" style="width:20px;height:20px;" />
              <div>
                <div class="card-title">${nome}</div>
                <div class="card-meta">Último: R$ ${entry.preco_estimado.toFixed(2)}</div>
              </div>
            </label>
            ${entry.item_id ? `<button class="btn-secondary btn-step" onclick="abrirHistorico('${entry.item_id}')">📈</button>` : ''}
          </div>
          <div class="market-inputs">
            <input type="number" value="${entry.qtd_comprada}" min="1" onchange="updMercado(${idx}, 'qtd_comprada', this.value)" title="Qtd" />
            <input type="number" step="0.01" value="${entry.preco_real}" onchange="updMercado(${idx}, 'preco_real', this.value)" placeholder="Preço R$" />
            <input type="text" value="${entry.marca || ''}" onchange="updMercado(${idx}, 'marca', this.value)" placeholder="Marca" />
          </div>
        </div>
      `;
    }).join('');
  }

  document.getElementById('totalCarrinho').textContent = formatarBRL(totalCar);
  document.getElementById('totalEstimadoMercado').textContent = formatarBRL(totalEst);
}

window.toggleCarrinho = (idx, checked) => {
  state.listaAtiva.itens[idx].no_carrinho = checked;
  salvarListaLocal();
  renderModoMercado();
};

window.updMercado = (idx, campo, valor) => {
  state.listaAtiva.itens[idx][campo] = campo === 'marca' ? valor : Number(valor || 0);
  salvarListaLocal();
  renderModoMercado();
};

async function finalizarCompraMercado() {
  const comprados = state.listaAtiva.itens.filter(i => i.no_carrinho);
  if (comprados.length === 0) {
    alert('Marque pelo menos um item no carrinho antes de finalizar.');
    return;
  }
  if (!confirm(`Finalizar compra com ${comprados.length} item(ns) e dar entrada no estoque?`)) return;

  try {
    const local = document.getElementById('inputLocalMercado').value.trim();
    await postGAS({
      action: 'finalizarCompra',
      lista_id: state.listaAtiva.lista_id || ('LST_' + Date.now()),
      local_mercado: local,
      usuario: getUsuario(),
      itensComprados: comprados
    });
    // Limpa lista ativa e recarrega tudo da nuvem
    state.listaAtiva = { lista_id: '', data_prevista: new Date().toISOString().slice(0, 10), itens: [] };
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

  document.getElementById('tituloHistorico').textContent = `Preços: ${item ? item.nome : ''}`;
  const chartBox = document.getElementById('graficoPrecos');
  const ul = document.getElementById('listaHistoricoPrecos');

  if (hist.length === 0) {
    chartBox.innerHTML = '<p class="hint" style="text-align:center;padding:30px 0;">Sem histórico de compras ainda.</p>';
    ul.innerHTML = '';
  } else {
    // Desenha curva simples em SVG
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
        <polyline fill="none" stroke="#38bdf8" stroke-width="3" points="${pts}" />
        ${precos.map((p, i) => {
          const [x, y] = pts.split(' ')[i].split(',');
          return `<circle cx="${x}" cy="${y}" r="4" fill="#22c55e" />`;
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
      <div class="row-3" style="margin-top:6px;">
        <input type="number" step="0.01" id="pPreco${n}" placeholder="Preço R$" oninput="calcularPapel()" />
        <input type="number" id="pRolos${n}" placeholder="Rolos" oninput="calcularPapel()" />
        <input type="number" id="pMetros${n}" placeholder="Metros" oninput="calcularPapel()" />
      </div>
      <div class="quick-m">
        <button type="button" onclick="setMetros(${n}, 20)">20m</button>
        <button type="button" onclick="setMetros(${n}, 30)">30m</button>
        <button type="button" onclick="setMetros(${n}, 60)">60m</button>
      </div>
      <div class="papel-res" id="pRes${n}">Preencha os campos</div>
    </div>
  `).join('');
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
    const preco = Number(document.getElementById('pPreco' + n).value);
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
