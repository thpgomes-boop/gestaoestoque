const API_URL = 'https://script.google.com/macros/s/AKfycbwXoIcmCCQl13ynmQMvLPP56ldYDNC5sx2hgcgoVIGF1f_CnI74PI82fQAi_7yLMseNag/exec';
const STORAGE_KEY = 'estoque_casa_cache_v1';
const LISTA_LOCAL_KEY = 'estoque_casa_lista_ativa_v1';

let state = {
  itens: [],
  historicoPrecos: [],
  categorias: [],
  mercados: [],
  estimativa_mensal: 0,
  categoriaAtiva: 'Todas',
  listaAtiva: {
    lista_id: '',
    data_prevista: new Date().toISOString().slice(0, 10),
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
  setStatus('
