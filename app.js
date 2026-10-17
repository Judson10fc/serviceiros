(() => {
  'use strict';

  const app = document.querySelector('#app');
  const toastEl = document.querySelector('#toast');
  const DATA_KEY = 'painelxp-demo-data-v3';
  const PREVIOUS_DATA_KEY = 'painelxp-demo-data-v2';
  const LEGACY_KEY = 'painelxp-static-clients';
  const API_MODE = Boolean(window.PainelFirebase?.enabled);
  const state = {
    view: 'login', loginMode: 'serviceiro', me: null, clients: [], customers: [], entries: [], cycles: [],
    query: '', clientStatus: 'active', entryClient: 'all', entryFrom: '', entryTo: '',
    cycleStatus: 'all', currentClientId: null, preview: false, modal: null, returnView: 'clients'
  };
  let toastTimer;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const id = () => globalThis.crypto?.randomUUID?.() || `px-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const integer = value => Number(value || 0).toLocaleString('pt-BR');
  // XP é inteiro, mas é exibido com separador de milhar enquanto o usuário digita.
  const parseXP = value => { const digits = String(value ?? '').replace(/\D/g, ''); return digits ? Number(digits) : 0; };
  const formatXPInput = value => { const digits = String(value ?? '').replace(/\D/g, ''); return digits ? Number(digits).toLocaleString('pt-BR', { maximumFractionDigits: 0, useGrouping: true }) : ''; };
  const billedXP = (entry, client) => entryXP(entry) / Math.max(1, Number(client?.xpPerBillingUnit ?? 1000));
  const formatBilledXP = value => Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  const toHex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  const fromHex = value => new Uint8Array(String(value).match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []);
  async function hashPassword(password, saltHex = '') {
    if (!globalThis.crypto?.subtle) throw new Error('Abra a demonstração por HTTPS ou localhost para criar senhas com segurança.');
    const salt = saltHex ? fromHex(saltHex) : globalThis.crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const result = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, key, 256);
    return { salt: toHex(salt), hash: toHex(new Uint8Array(result)) };
  }
  async function verifyPassword(password, salt, expected) {
    if (!salt || !expected) return false;
    const result = await hashPassword(password, salt);
    return result.hash === expected;
  }
  const fmtDate = value => {
    if (!value) return '—';
    const parts = String(value).slice(0, 10).split('-').map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return esc(value);
    return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString('pt-BR');
  };
  const isoToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };
  const activeEntries = () => state.entries.filter(x => !x.deletedAt && x.status !== 'deleted' && (API_MODE || state.me?.role !== 'serviceiro' || String(x.serviceiroId) === String(state.me.id)));
  const activeCycles = () => state.cycles.filter(x => !x.deletedAt && x.status !== 'deleted' && (API_MODE || state.me?.role !== 'serviceiro' || String(x.serviceiroId) === String(state.me.id)));
  const activeClients = () => state.clients.filter(x => x.status !== 'archived');
  const visibleCustomers = () => state.customers.filter(x => API_MODE || state.me?.role !== 'serviceiro' || String(x.serviceiroId) === String(state.me.id));
  const activeCustomers = () => visibleCustomers().filter(x => x.status !== 'archived');
  const clientById = value => state.clients.find(c => String(c.id) === String(value));
  const customerById = value => state.customers.find(c => String(c.id) === String(value));
  const entryClientName = entry => customerById(entry.clientId)?.name || clientById(entry.serviceiroId)?.name || entry.clientName || 'Cliente removido';
  const entryXP = entry => entry.dayStatus === 'no_activity' ? 0 : Math.max(0, Number(entry.xpFinal || 0) - Number(entry.xpInitial || 0));
  const rateFor = (client, cycle) => Number(cycle?.rateBrlPer1000Xp ?? client?.rateBrlPer1000Xp ?? 0);
  const amountFor = (entry, client, cycle) => entryXP(entry) / Number(client?.xpPerBillingUnit || 1000) * rateFor(client, cycle);
  const cycleEntries = cycle => activeEntries().filter(e => String(e.clientId) === String(cycle.clientId) && e.referenceDate >= cycle.startDate && e.referenceDate <= cycle.endDate);
  const cycleTotals = cycle => {
    const client = customerById(cycle.clientId);
    const entries = cycleEntries(cycle);
    const xp = entries.reduce((sum, entry) => sum + entryXP(entry), 0);
    const total = entries.reduce((sum, entry) => sum + amountFor(entry, client, cycle), 0);
    const remaining = cycle.targetUnit === 'xp' ? Math.max(0, Number(cycle.targetValue || 0) - xp) : Math.max(0, Number(cycle.targetValue || 0) - total);
    return { xp, total, remaining, entries };
  };

  function readDemoData() {
    try {
      const raw = localStorage.getItem(DATA_KEY);
      if (raw) return JSON.parse(raw);
      const previous = JSON.parse(localStorage.getItem(PREVIOUS_DATA_KEY) || 'null');
      if (previous) return { clients: previous.clients || [], customers: previous.customers || [], entries: previous.entries || [], cycles: previous.cycles || [] };
      const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || '[]');
      const migrated = {
        clients: legacy.map(c => ({
          id: c.id || id(), name: c.name || '', nickname: c.nickname || '', email: c.email || '',
          status: 'active', xpPerBillingUnit: c.mode === 'raw' ? 1 : 1000,
          rateBrlPer1000Xp: Number(c.tri || 0), cycleType: c.cycle || 'Semanal',
          targetValue: 0, targetUnit: 'brl', createdAt: new Date().toISOString()
        })), customers: [], entries: [], cycles: []
      };
      return migrated;
    } catch (_) { return { clients: [], customers: [], entries: [], cycles: [] }; }
  }
  function saveDemoData() {
    if (API_MODE) return;
    localStorage.setItem(DATA_KEY, JSON.stringify({ clients: state.clients, customers: state.customers, entries: state.entries, cycles: state.cycles }));
    // Discard the old demo key. It could contain passwords from the earlier prototype.
    localStorage.removeItem(LEGACY_KEY);
    localStorage.removeItem(PREVIOUS_DATA_KEY);
  }
  const initial = readDemoData();
  state.clients = Array.isArray(initial.clients) ? initial.clients : [];
  state.customers = Array.isArray(initial.customers) ? initial.customers : [];
  state.entries = Array.isArray(initial.entries) ? initial.entries : [];
  state.cycles = Array.isArray(initial.cycles) ? initial.cycles : [];

  function notify(message, error = false) {
    toastEl.textContent = message;
    toastEl.classList.toggle('error', error);
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 3600);
  }
  function logo() { return `<div class="brand"><span class="mark">PX</span><span><strong>Painel XP</strong><small>serviceiros</small></span></div>`; }
  function listFrom(payload) { return Array.isArray(payload) ? payload : (payload?.items || payload?.data || []); }
  function normalizeClient(c) {
    const { passwordHash, passwordSalt, initialPassword, ...safe } = c;
    return { ...safe, id: c.id ?? c.serviceiroId, nickname: c.nickname ?? c.nick ?? '',
      xpPerBillingUnit: Number(c.xpPerBillingUnit ?? 1000), rateBrlPer1000Xp: Number(c.rateBrlPer1000Xp ?? c.valorBrlPorUnidade ?? 0),
      cycleType: c.cycleType ?? 'Semanal', status: c.status ?? 'active' };
  }
  function normalizeCustomer(c) {
    return { ...c, id: c.id ?? c.clienteId, nickname: c.nickname ?? c.nick ?? '',
      xpPerBillingUnit: Number(c.xpPerBillingUnit ?? 1000), rateBrlPer1000Xp: Number(c.rateBrlPer1000Xp ?? c.valorBrlPorUnidade ?? 0),
      cycleType: c.cycleType ?? 'Semanal', status: c.status ?? 'active' };
  }
  async function api(path, method = 'GET', body) {
    if (!window.PainelFirebase?.enabled) throw new Error('O Firebase não foi carregado. Verifique a conexão e os arquivos config.js/firebase-adapter.js.');
    return window.PainelFirebase.route(path, method, body);
  }
  async function loadApiData(keepView = false) {
    const nextView = keepView ? state.view : (state.me?.role === 'client' ? 'portal' : 'dashboard');
    if (state.me?.role === 'admin' || state.me?.role === 'administrator') {
      state.clients = []; state.customers = []; state.entries = []; state.cycles = [];
      throw new Error('O painel administrativo de contas foi removido desta versão sem Cloud Functions.');
    } else if (state.me?.role === 'client' && window.PainelFirebase?.enabled) {
      const portal = await window.PainelFirebase.loadClientPortal();
      state.clients = [normalizeClient(portal.profile)]; state.customers = [normalizeCustomer(portal.profile)];
      state.entries = listFrom(portal.entries); state.cycles = listFrom(portal.cycles);
      state.currentClientId = portal.profile.id; state.view = 'portal'; state.preview = false;
    } else {
      const [summary, customers, entries, cycles] = await Promise.all([
        api('/serviceiro/resumo'), api('/serviceiro/clientes'), api('/serviceiro/apuracoes'), api('/serviceiro/ciclos')
      ]);
      const profile = normalizeClient(summary?.serviceiro || summary?.profile || summary || {});
      state.clients = [profile]; state.customers = listFrom(customers).map(normalizeCustomer);
      state.entries = listFrom(entries); state.cycles = listFrom(cycles);
      state.preview = false;
    }
    state.view = nextView;
  }
  async function login(email, password, expectedRole) {
    if (!API_MODE) {
      const user = state.clients.find(c => c.email?.toLowerCase() === email.toLowerCase() && c.status === 'active');
      if (!user || !(await verifyPassword(password, user.passwordSalt, user.passwordHash))) throw new Error('E-mail ou senha inválidos.');
      state.me = { id: user.id, role: 'serviceiro', name: user.name, email: user.email, mustChangePassword: Boolean(user.mustChangePassword) };
      if (expectedRole !== 'serviceiro') { state.me=null; throw new Error('Esta conta não tem acesso administrativo.'); }
      if (state.me.mustChangePassword) { state.view = 'password-change'; render(); return; }
      state.view = 'dashboard'; render(); return;
    }
    await api('/auth/session', 'POST', { email, password });
    state.me = await api('/me');
    const actualRole = state.me.role === 'administrator' ? 'admin' : state.me.role;
    if (expectedRole !== 'any' && actualRole !== expectedRole) {
      try { await api('/auth/session', 'DELETE'); } catch (_) {}
      state.me = null;
      throw new Error(expectedRole === 'admin' ? 'Esta conta não tem acesso administrativo.' : 'Esta conta não tem acesso à área do serviceiro.');
    }
    if (state.me.mustChangePassword) { state.view = 'password-change'; render(); return; }
    await loadApiData(); render();
  }
  async function logout() {
    if (API_MODE && state.me) { try { await api('/auth/session', 'DELETE'); } catch (_) {} }
    state.me = null; state.preview = false; state.view = 'login'; state.loginMode = 'serviceiro'; render();
  }

  function statusLabel(value) {
    return ({ active: 'Ativo', inactive: 'Inativo', archived: 'Arquivado', open: 'Aberto', closed: 'Fechado', paid: 'Pago', no_activity: 'Sem atividade', pending: 'Pendente', awaiting_activation: 'Aguardando senha', invited: 'Convite enviado', expired: 'Convite expirado' })[value] || value || '—';
  }
  function pill(value) { return `<span class="pill ${esc(value)}">${esc(statusLabel(value))}</span>`; }
  function metric(label, value, caption, color = '') {
    return `<article class="metric ${color}"><span>${esc(label)}</span><strong>${value}</strong><small>${esc(caption)}</small></article>`;
  }
  function shell(title, subtitle, content, primary = '') {
    const active = state.view === 'client-detail' ? (state.me?.role === 'serviceiro' ? 'customers' : 'clients') : state.view;
    const demo = !API_MODE ? `<span class="demo-tag">Demonstração local</span>` : '';
    const isAdmin = state.me?.role === 'admin' || state.me?.role === 'administrator';
    const navItems = isAdmin
      ? [['dashboard','Visão geral','▦'],['clients','Serviceiros','♙']]
      : [['dashboard','Visão geral','▦'],['customers','Clientes','♙'],['entries','Cadastrar XP','▤']];
    app.innerHTML = `<div class="app-shell">
      <aside class="sidebar">${logo()}<nav class="nav" aria-label="Navegação principal">
        ${navItems.map(([key,label,icon])=>`<button class="nav-item ${active===key?'active':''}" data-action="nav" data-view="${key}"><span class="nav-icon">${icon}</span><span>${label}</span></button>`).join('')}
      </nav><div class="sidebar-bottom"><div class="account"><span class="avatar">${esc((state.me?.name || state.me?.displayName || 'A').slice(0,1).toUpperCase())}</span><div><strong>${esc(state.me?.name || state.me?.displayName || 'Administrador')}</strong><small>${API_MODE?'Conta autenticada':'Modo demonstração'}</small></div></div>${demo}<button class="link-button" data-action="logout">Sair</button></div></aside>
      <main class="main"><header class="topbar"><div><span class="eyebrow">PAINEL XP</span><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="top-actions">${primary}${demo}</div></header>${content}</main>
    </div>${renderModal()}`;
  }
  function renderLogin(message = '') {
    const serviceiroLogin = state.loginMode === 'serviceiro';
    const title = serviceiroLogin ? 'Acesse seu portal' : 'Acesse sua conta de cliente';
    const intro = API_MODE
      ? serviceiroLogin ? 'Entre com seu e-mail e senha do Serviceiro, ou crie sua conta.' : 'Entre com o e-mail e a senha fornecidos pelo Serviceiro.'
      : serviceiroLogin
        ? 'Entre com o e-mail e a senha provisória cadastrados pelo administrador. No primeiro acesso, você criará sua senha pessoal.'
        : 'O banco ainda não está conectado. Use a demonstração para organizar cadastros, apurações e ciclos neste navegador.';
    const access = API_MODE
      ? `<form class="form" id="login-form" data-role="any"><label>E-mail<input type="email" name="email" autocomplete="username" required></label><label>Senha<input type="password" name="password" autocomplete="current-password" required></label><button class="primary wide" type="submit">Entrar</button><button class="link-button" type="button" data-action="reset-password">Esqueci minha senha</button></form>${serviceiroLogin ? `<button class="secondary wide" data-action="register-serviceiro">Criar conta de Serviceiro</button>` : ''}`
      : `<div class="form-error">O Firebase não foi carregado. Confira a conexão e os arquivos de configuração; nenhum dado local de demonstração será usado.</div>`;
    const switchAction = serviceiroLogin ? 'client-login' : 'serviceiro-login';
    const switchLabel = serviceiroLogin ? 'É Cliente?' : 'É Serviceiro?';
    const switchText = serviceiroLogin ? 'Entrar como Cliente' : 'Entrar como Serviceiro';
    app.innerHTML = `<main class="login"><section class="login-visual">${logo()}<div class="hero"><span class="eyebrow">APURAÇÃO SEM COMPLICAÇÃO</span><h1>O trabalho de cada dia, organizado.</h1><p>Histórico de XP e valores em um único lugar.</p></div><p class="security">Autenticação pelo Firebase; os dados ficam isolados por conta.</p></section>
      <section class="login-card"><div class="login-inner"><span class="eyebrow">${serviceiroLogin?'ÁREA DO SERVICEIRO':'ACESSAR PAINEL'}</span><h2>${title}</h2><p class="muted">${intro}</p>
      ${message?`<div class="form-error">${esc(message)}</div>`:''}${access}
      <div class="login-switch"><div><strong>${switchLabel}</strong><span>${API_MODE?'A conta é identificada pelo Firebase Authentication.':'Configure o Firebase para ativar o acesso real.'}</span></div><button class="secondary" data-action="${switchAction}">${switchText}</button></div>
      </div></section></main>`;
  }
  function renderServiceiroRegistration(message = '') {
    app.innerHTML = `<main class="login"><section class="login-visual">${logo()}<div class="hero"><span class="eyebrow">NOVO SERVICEIRO</span><h1>Organize seus serviços.</h1><p>Crie sua conta individual para gerenciar clientes e cadastros de XP.</p></div><p class="security">Sua conta será vinculada ao seu UID do Firebase Authentication.</p></section><section class="login-card"><div class="login-inner"><span class="eyebrow">CADASTRO</span><h2>Criar conta de Serviceiro</h2><p class="muted">Preencha os dados para começar.</p>${message?`<div class="form-error">${esc(message)}</div>`:''}<form class="form" id="serviceiro-registration-form"><label>Nome completo<input name="name" required maxlength="120"></label><label>Nick no jogo<input name="nickname" maxlength="80"></label><label>E-mail<input name="email" type="email" autocomplete="email" required maxlength="160"></label><label>Senha (mínimo 8 caracteres)<input name="password" type="password" autocomplete="new-password" minlength="8" required></label><label>Confirmar senha<input name="passwordConfirm" type="password" autocomplete="new-password" minlength="8" required></label><button class="primary wide" type="submit">Criar minha conta</button><button class="secondary wide" type="button" data-action="cancel-registration">Voltar ao login</button></form></div></section></main>`;
  }

  function renderPasswordChange(message = '') {
    app.innerHTML = `<main class="login"><section class="login-visual">${logo()}<div class="hero"><span class="eyebrow">PRIMEIRO ACESSO</span><h1>Crie sua senha pessoal.</h1><p>Defina uma senha que só você conheça para proteger seu acesso.</p></div><p class="security">A senha provisória deixa de valer após esta etapa.</p></section>
      <section class="login-card"><div class="login-inner"><span class="eyebrow">ATUALIZAÇÃO OBRIGATÓRIA</span><h2>Troque a senha provisória</h2><p class="muted">Para continuar, crie sua senha pessoal com pelo menos 8 caracteres.</p>${message?`<div class="form-error">${esc(message)}</div>`:''}
      <form class="form" id="password-change-form"><label>Nova senha<input type="password" name="password" autocomplete="new-password" minlength="8" maxlength="128" required></label><label>Confirme a nova senha<input type="password" name="passwordConfirm" autocomplete="new-password" minlength="8" maxlength="128" required></label><button class="primary wide" type="submit">Salvar minha senha</button></form>
      </div></section></main>`;
  }

  function dashboardView() {
    if (state.me?.role === 'serviceiro') {
      const customers = activeCustomers().filter(c => c.status === 'active');
      const entries = activeEntries().filter(e => String(e.referenceDate || '').slice(0,7) === isoToday().slice(0,7));
      const xp = entries.reduce((n,e)=>n+entryXP(e),0);
      const total = entries.reduce((n,e)=>n+amountFor(e,customerById(e.clientId)),0);
            const recent = activeEntries().slice().sort((a,b)=>(b.referenceDate||'').localeCompare(a.referenceDate||'')).slice(0,6);
      return `<section class="metrics">${metric('Clientes ativos',integer(customers.length),'seus cadastros')}${metric('XP apurado no mês',integer(xp),'registros do mês','blue')}${metric('Valor estimado',money(total),'estimativa calculada','gold')}</section>
        <section class="section"><div class="toolbar"><div><h2>Apurações recentes</h2><p>Registros dos seus clientes.</p></div><button class="secondary" data-action="nav" data-view="entries">Ver apurações</button></div>${recent.length?entriesTable(recent,false):emptyState('Ainda não há apurações','Cadastre um cliente e registre a primeira apuração.')}</section>
        <section class="quick-actions"><button class="quick-card" data-action="new-customer"><strong>＋ Novo cliente</strong><span>Cadastre quem você atende.</span></button><button class="quick-card" data-action="new-entry"><strong>＋ Cadastrar XP</strong><span>Registre o XP de um cliente.</span></button></section>`;
    }
    const active = state.clients.filter(c => c.status === 'active').length;
    const waiting = state.clients.filter(c => c.status === 'active' && (c.mustChangePassword || c.accessStatus === 'awaiting_activation')).length;
    const total = state.clients.filter(c => c.status !== 'archived').length;
    return `<section class="metrics">${metric('Acessos cadastrados',integer(total),'serviceiros não arquivados')}${metric('Serviceiros ativos', integer(active),'contas liberadas','blue')}${metric('Primeiro acesso',integer(waiting),'troca de senha pendente','gold')}</section>
      <section class="section"><div class="toolbar"><div><h2>Administração de acessos</h2><p>Libere uma conta para cada serviceiro. Clientes e cadastros de XP são administrados em sua própria área.</p></div><button class="primary" data-action="new-client">＋ Novo serviceiro</button></div>${state.clients.length?`<div class="table-wrap"><table><thead><tr><th>Serviceiro</th><th>Situação</th><th>Acesso</th><th>E-mail</th></tr></thead><tbody>${state.clients.slice(0,6).map(c=>`<tr><td><strong>${esc(c.name)}</strong><small class="cell-sub">${esc(c.nickname||'')}</small></td><td>${pill(c.status)}</td><td>${c.mustChangePassword?pill('pending'):pill(c.accessStatus||'active')}</td><td>${esc(c.email)}</td></tr>`).join('')}</tbody></table></div>`:emptyState('Nenhum acesso liberado','Cadastre o primeiro serviceiro para que ele possa entrar e organizar os próprios clientes.',`<button class="primary" data-action="new-client">Cadastrar serviceiro</button>`)}</section>`;
  }
  function emptyState(title, detail, action = '') {
    return `<div class="empty-state"><span class="empty-mark">PX</span><h3>${esc(title)}</h3><p>${esc(detail)}</p>${action}</div>`;
  }
  function clientsView() {
    const filtered = state.clients.filter(c => {
      const matchStatus = state.clientStatus === 'all' || c.status === state.clientStatus;
      const q = state.query.trim().toLowerCase();
      return matchStatus && (!q || `${c.name} ${c.nickname} ${c.email}`.toLowerCase().includes(q));
    });
    const rows = filtered.map(c=>`<tr><td><div class="client-cell"><span class="avatar">${esc((c.name||'?').slice(0,1).toUpperCase())}</span><div><strong>${esc(c.name)}</strong><small>${esc(c.nickname)} · ${esc(c.email)}</small></div></div></td><td>${pill(c.status)}</td><td>${c.mustChangePassword?pill('pending'):pill(c.accessStatus||'active')}</td><td class="actions"><button data-action="edit-client" data-id="${esc(c.id)}">Editar acesso</button><button class="more-action" data-action="${c.status==='active'?'deactivate-client':'reactivate-client'}" data-id="${esc(c.id)}">${c.status==='active'?'Desativar':'Ativar'}</button><button class="danger-link" data-action="archive-client" data-id="${esc(c.id)}">Arquivar</button></td></tr>`).join('');
    return `<section class="section"><div class="toolbar"><div><h2>Base de serviceiros</h2><p>Gerencie somente as contas de acesso. Cada serviceiro mantém seus próprios clientes e registros.</p></div><div class="filters"><input class="search" id="client-search" value="${esc(state.query)}" placeholder="Buscar nome, nick ou e-mail" aria-label="Buscar serviceiro"><select id="client-status" aria-label="Filtrar situação"><option value="active" ${state.clientStatus==='active'?'selected':''}>Ativos</option><option value="inactive" ${state.clientStatus==='inactive'?'selected':''}>Inativos</option><option value="archived" ${state.clientStatus==='archived'?'selected':''}>Arquivados</option><option value="all" ${state.clientStatus==='all'?'selected':''}>Todos</option></select></div></div>
      ${filtered.length?`<div class="table-wrap"><table><thead><tr><th>Serviceiro</th><th>Situação</th><th>Acesso</th><th>Ações</th></tr></thead><tbody>${rows}</tbody></table></div>`:emptyState('Nenhum cadastro encontrado','Ajuste a busca ou cadastre um novo serviceiro.',`<button class="primary" data-action="new-client">Cadastrar serviceiro</button>`)}</section>`;
  }
  function customersView() {
    const filtered = visibleCustomers().filter(c => {
      const matchStatus = state.clientStatus === 'all' || c.status === state.clientStatus;
      const q = state.query.trim().toLowerCase();
      return matchStatus && (!q || `${c.name} ${c.nickname} ${c.email} ${c.phone}`.toLowerCase().includes(q));
    });
    const rows = filtered.map(c=>`<tr><td><div class="client-cell"><span class="avatar">${esc((c.name||'?').slice(0,1).toUpperCase())}</span><div><strong>${esc(c.name)}</strong><small>${esc(c.nickname||'')}${c.email?` · ${esc(c.email)}`:''}</small></div></div></td><td>${pill(c.status)}</td><td>${money(c.rateBrlPer1000Xp)}<small class="cell-sub">${Number(c.xpPerBillingUnit||1000)===1?'por XP integral':'por 1.000 XP'}</small></td><td class="actions"><button data-action="edit-customer" data-id="${esc(c.id)}">Editar</button><button class="more-action" data-action="${c.status==='active'?'deactivate-customer':'reactivate-customer'}" data-id="${esc(c.id)}">${c.status==='active'?'Desativar':'Ativar'}</button><button class="danger-link" data-action="archive-customer" data-id="${esc(c.id)}">Arquivar</button></td></tr>`).join('');
    return `<section class="section"><div class="toolbar"><div><h2>Seus clientes</h2><p>Cadastre clientes para depois cadastrar XP.</p></div><div class="filters"><input class="search" id="client-search" value="${esc(state.query)}" placeholder="Buscar cliente" aria-label="Buscar cliente"><select id="client-status" aria-label="Filtrar situação"><option value="active" ${state.clientStatus==='active'?'selected':''}>Ativos</option><option value="inactive" ${state.clientStatus==='inactive'?'selected':''}>Inativos</option><option value="archived" ${state.clientStatus==='archived'?'selected':''}>Arquivados</option><option value="all" ${state.clientStatus==='all'?'selected':''}>Todos</option></select></div></div>${filtered.length?`<div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Situação</th><th>Taxa</th><th>Ações</th></tr></thead><tbody>${rows}</tbody></table></div>`:emptyState('Nenhum cliente cadastrado','Cadastre seu primeiro cliente para organizar as apurações.',`<button class="primary" data-action="new-customer">Cadastrar cliente</button>`)}</section>`;
  }
  function entriesTable(items, showActions = true) {
    return `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Cliente</th><th>XP inicial</th><th>XP final</th><th>XP feito</th><th>Valor estimado</th><th>Situação</th>${showActions?'<th>Ações</th>':''}</tr></thead><tbody>${items.map(e=>{const c=customerById(e.clientId);return `<tr><td>${fmtDate(e.referenceDate)}</td><td><strong>${esc(entryClientName(e))}</strong></td><td>${integer(e.xpInitial)}</td><td>${integer(e.xpFinal)}</td><td>${formatBilledXP(billedXP(e,c))}</td><td>${money(amountFor(e,c))}</td><td>${pill(e.dayStatus==='no_activity'?'no_activity':'active')}</td>${showActions?`<td class="actions"><button data-action="edit-entry" data-id="${esc(e.id)}">Editar</button><button class="danger-link" data-action="delete-entry" data-id="${esc(e.id)}">Excluir</button></td>`:''}</tr>`;}).join('')}</tbody></table></div>`;
  }
  function entriesView() {
    const items = activeEntries().filter(e => (state.entryClient==='all'||String(e.clientId)===String(state.entryClient)) && (!state.entryFrom||e.referenceDate>=state.entryFrom) && (!state.entryTo||e.referenceDate<=state.entryTo)).sort((a,b)=>(b.referenceDate||'').localeCompare(a.referenceDate||''));
    const options = activeCustomers().map(c=>`<option value="${esc(c.id)}" ${String(c.id)===String(state.entryClient)?'selected':''}>${esc(c.name)}</option>`).join('');
    return `<section class="section"><div class="toolbar"><div><h2>Apurações diárias</h2><p>XP por cliente e data. O XP feito é calculado pelo sistema.</p></div><button class="primary" data-action="new-entry">＋ Cadastrar XP</button></div><div class="filters filter-row"><select id="entry-client"><option value="all">Todos os clientes</option>${options}</select><label>De<input type="date" id="entry-from" value="${esc(state.entryFrom)}"></label><label>Até<input type="date" id="entry-to" value="${esc(state.entryTo)}"></label><button class="secondary" data-action="clear-entry-filters">Limpar filtros</button></div>${items.length?entriesTable(items):emptyState('Nenhuma apuração neste filtro','Registre uma apuração diária para acompanhar XP e valores.')}</section>`;
  }
  function cyclesView() { // legado interno; removido da navegação e da interface principal.
    const filtered = activeCycles().filter(c=>state.cycleStatus==='all'||c.status===state.cycleStatus).slice().sort((a,b)=>(b.startDate||'').localeCompare(a.startDate||''));
    const options = `<option value="all">Todos os status</option>${[['open','Aberto'],['closed','Fechado'],['paid','Pago']].map(([v,l])=>`<option value="${v}" ${state.cycleStatus===v?'selected':''}>${l}</option>`).join('')}`;
    const rows = filtered.map(c=>{const client=customerById(c.clientId);const t=cycleTotals(c);return `<tr><td><strong>${esc(client?.name||c.clientName||'Cliente removido')}</strong></td><td>${fmtDate(c.startDate)} a ${fmtDate(c.endDate)}</td><td>${integer(t.xp)}</td><td>${money(t.total)}</td><td>${c.targetValue? (c.targetUnit==='xp'?`${integer(t.remaining)} XP`:money(t.remaining)):'—'}</td><td>${pill(c.status)}</td><td class="actions">${c.status==='open'?`<button data-action="edit-cycle" data-id="${esc(c.id)}">Editar</button><button data-action="close-cycle" data-id="${esc(c.id)}">Fechar</button><button class="danger-link" data-action="delete-cycle" data-id="${esc(c.id)}">Arquivar</button>`:''}${c.status==='closed'?`<button data-action="mark-paid" data-id="${esc(c.id)}">Marcar pago</button><button class="danger-link" data-action="delete-cycle" data-id="${esc(c.id)}">Arquivar</button>`:''}${c.status==='paid'?`<small>Pago em ${fmtDate(c.paidAt)}</small>`:''}</td></tr>`;}).join('');
    return `<section class="section"><div class="toolbar"><div><h2>Ciclos de apuração</h2><p>Períodos e valores organizados por cliente.</p></div><button class="primary" data-action="new-cycle">＋ Novo ciclo</button></div><div class="filters"><select id="cycle-status" aria-label="Filtrar status do ciclo">${options}</select></div>${filtered.length?`<div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Período</th><th>XP feito</th><th>Valor apurado</th><th>Falta</th><th>Status</th><th>Ações</th></tr></thead><tbody>${rows}</tbody></table></div>`:emptyState('Nenhum ciclo encontrado','Crie um ciclo para organizar o período de apuração.')}</section>`;
  }
  function clientDetailView() {
    const c = clientById(state.currentClientId);
    if (!c) return emptyState('Serviceiro não encontrado','O cadastro pode ter sido arquivado.');
    const es = activeEntries().filter(e=>String(e.serviceiroId)===String(c.id)).sort((a,b)=>(b.referenceDate||'').localeCompare(a.referenceDate||'')).slice(0,8);
        const xp = es.reduce((n,e)=>n+entryXP(e),0);
    const amount = es.reduce((n,e)=>n+amountFor(e,c),0);
    return `<section class="profile-head"><div class="profile-ident"><span class="avatar large">${esc((c.name||'?').slice(0,1).toUpperCase())}</span><div><span class="eyebrow">PERFIL DO SERVICEIRO</span><h2>${esc(c.name)}</h2><p>${esc(c.nickname)} · ${esc(c.email)}</p></div></div><div class="actions"><button class="primary" data-action="edit-client" data-id="${esc(c.id)}">Editar acesso</button></div></section>
      <section class="metrics three">${metric('Situação',pill(c.status),'acesso do cadastro')}${metric('XP recente',integer(xp),'últimas apurações','blue')}${metric('Valor estimado',money(amount),'mesmas apurações','gold')}</section>
      <section class="section"><div class="toolbar"><div><h2>Apurações recentes</h2><p>Dados vinculados a ${esc(c.name)}.</p></div><button class="secondary" data-action="new-entry" data-client-id="${esc(c.id)}">＋ Cadastrar XP</button></div>${es.length?entriesTable(es):emptyState('Sem apurações','Os lançamentos diários aparecerão aqui.')}</section>`;
  }
  function portalView() {
    const c = clientById(state.currentClientId) || state.clients[0];
    if (!c) return emptyState('Perfil indisponível','Entre novamente ou peça ao serviceiro para verificar o cadastro.');
    const myEntries = activeEntries().filter(e=>String(e.clientId)===String(c.id) || String(e.clientUid)===String(c.id)).sort((a,b)=>(b.referenceDate||'').localeCompare(a.referenceDate||''));
    const totalXP = myEntries.reduce((sum,e)=>sum+entryXP(e),0);
    const totalValue = myEntries.reduce((sum,e)=>sum+amountFor(e,c),0);
    return `${state.preview?`<div class="preview-banner">Prévia local do portal.<button class="link-button" data-action="back-to-admin">Voltar</button></div>`:''}
      <header class="portal-heading"><div><span class="eyebrow">SEU HISTÓRICO</span><h2>Olá, ${esc((c.name||'').split(' ')[0])}.</h2><p>Acompanhe todo o XP cadastrado e os valores acumulados.</p></div>${state.preview?'':`<button class="secondary" data-action="logout">Sair</button>`}</header>
      <section class="metrics three">${metric('XP acumulado',integer(totalXP),'soma de todas as apurações','blue')}${metric('Valor acumulado',money(totalValue),'total estimado a pagar','gold')}${metric('Dias registrados',integer(myEntries.length),'registros no histórico','green')}</section>
      <section class="section"><div class="toolbar"><div><h2>Minhas apurações</h2><p>Histórico em modo de consulta.</p></div></div>${myEntries.length?entriesTable(myEntries,false):emptyState('Nenhuma apuração','Quando o serviceiro cadastrar XP, os registros aparecerão aqui.')}</section>`;
  }
  function render() {
    if (!state.me) return renderLogin();
    if (state.me.mustChangePassword) return renderPasswordChange();
    if (state.me.role === 'client') { app.innerHTML = `<div class="app-shell"><main class="main">${portalView()}</main></div>`; return; }
    const isAdmin = state.me.role === 'admin' || state.me.role === 'administrator';
    const titles = {
      dashboard: isAdmin ? ['Visão geral','Libere e organize o acesso dos serviceiros.'] : ['Meu painel','Gerencie seus clientes e cadastros de XP.'],
      clients: ['Serviceiros','Crie, edite, bloqueie ou arquive os acessos dos serviceiros.'],
      customers: ['Clientes','Cadastre e gerencie seus clientes.'],
      entries: ['Cadastrar XP','Registre e consulte o XP dos seus clientes.'],
    };
    const [title, subtitle] = titles[state.view] || titles.dashboard;
    const primary = state.view === 'clients' ? `<button class="primary" data-action="new-client">＋ Novo serviceiro</button>` : state.view === 'customers' ? `<button class="primary" data-action="new-customer">＋ Novo cliente</button>` : '';
    const content = state.view === 'clients' && isAdmin ? clientsView() : state.view === 'customers' && !isAdmin ? customersView() : state.view === 'entries' && !isAdmin ? entriesView() : dashboardView();
    shell(title, subtitle, content, primary);
  }

  function clientForm(c = {}) {
    const isEdit = Boolean(c.id);
    return `<div class="modal-backdrop" data-action="backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button class="modal-close" data-action="close-modal" aria-label="Fechar">×</button><span class="eyebrow">${isEdit?'EDITAR':'NOVO'} SERVICEIRO</span><h2 id="modal-title">${isEdit?'Atualizar cadastro':'Cadastrar serviceiro'}</h2><form class="form" id="client-form" data-id="${esc(c.id||'')}">
      <div class="grid"><label>Nome completo<input name="name" value="${esc(c.name)}" required maxlength="120"></label><label>Nick no jogo<input name="nickname" value="${esc(c.nickname)}" required maxlength="80"></label><label>E-mail de acesso<input name="email" type="email" value="${esc(c.email)}" required maxlength="160"></label><label>Situação<select name="status"><option value="active" ${c.status!=='inactive'&&c.status!=='archived'?'selected':''}>Ativo</option><option value="inactive" ${c.status==='inactive'?'selected':''}>Inativo</option><option value="archived" ${c.status==='archived'?'selected':''}>Arquivado</option></select></label>${isEdit?`<label>Nova senha provisória (opcional)<input name="initialPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128"><small>Se preenchida, será exigida troca no próximo acesso.</small></label><label>Confirme a nova senha<input name="passwordConfirm" type="password" autocomplete="new-password" minlength="8" maxlength="128"></label>`:`<label>Senha provisória<input name="initialPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required><small>O serviceiro trocará por sua senha pessoal ao entrar pela primeira vez.</small></label><label>Confirme a senha provisória<input name="passwordConfirm" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label>`}</div>
      <p class="note">O dono do site libera a conta com uma senha provisória. No primeiro login, o serviceiro define a própria senha pessoal; depois, cadastra e administra os clientes na própria área.</p><div class="form-actions"><button type="button" class="secondary" data-action="close-modal">Cancelar</button><button class="primary" type="submit">${isEdit?'Salvar alterações':'Criar serviceiro'}</button></div></form></section></div>`;
  }
  function customerForm(c = {}) {
    const isEdit = Boolean(c.id);
    return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button class="modal-close" data-action="close-modal" aria-label="Fechar">×</button><span class="eyebrow">${isEdit?'EDITAR':'NOVO'} CLIENTE</span><h2 id="modal-title">${isEdit?'Atualizar cliente':'Cadastrar cliente'}</h2><form class="form" id="customer-form" data-id="${esc(c.id||'')}">
      <div class="grid"><label>Nome do cliente<input name="name" value="${esc(c.name)}" required maxlength="120"></label><label>Nick/identificação<input name="nickname" value="${esc(c.nickname)}" maxlength="80"></label><label>E-mail de acesso<input name="email" type="email" value="${esc(c.email)}" maxlength="160" required><small>Usado no login e na recuperação da conta.</small></label>${isEdit?`<p class="note full">Para redefinir a senha, o Cliente deve usar a recuperação por e-mail do Firebase Authentication. Sem Cloud Functions, o Serviceiro não pode alterar diretamente a senha de outra conta com segurança.</p>`:`<label>Senha provisória<input name="initialPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label><label>Confirme a senha provisória<input name="passwordConfirm" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label>`}<label>Telefone/contato<input name="phone" value="${esc(c.phone)}" maxlength="40"></label><label>Situação<select name="status"><option value="active" ${c.status!=='inactive'&&c.status!=='archived'?'selected':''}>Ativo</option><option value="inactive" ${c.status==='inactive'?'selected':''}>Inativo</option><option value="archived" ${c.status==='archived'?'selected':''}>Arquivado</option></select></label><label class="full">Deseja dividir o XP por 1000 para calcular o valor?<select name="xpPerBillingUnit" required><option value="1000" ${Number(c.xpPerBillingUnit??1000)===1000?'selected':''}>Sim — (XP final − XP inicial) ÷ 1000</option><option value="1" ${Number(c.xpPerBillingUnit??1000)===1?'selected':''}>Não — usar o XP integral (XP final − XP inicial)</option></select><small>Você pode alterar essa opção depois editando o cliente.</small></label><label>Valor por unidade em R$<input name="rateBrlPer1000Xp" type="number" min="0" step="0.01" value="${esc(c.rateBrlPer1000Xp??1.2)}" required><small>Multiplicado pelo XP calculado conforme a opção acima.</small></label></div>
      <div class="form-actions"><button type="button" class="secondary" data-action="close-modal">Cancelar</button><button class="primary" type="submit">${isEdit?'Salvar cliente':'Cadastrar cliente'}</button></div></form></section></div>`;
  }
  function entryForm(entry = {}, presetClient = '') {
    const isEdit = Boolean(entry.id);
    const clients = activeCustomers().filter(c=>c.status==='active');
    return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button class="modal-close" data-action="close-modal" aria-label="Fechar">×</button><span class="eyebrow">APURAÇÃO DIÁRIA</span><h2 id="modal-title">${isEdit?'Editar registro':'Cadastrar XP'}</h2>${clients.length?`<form class="form" id="entry-form" data-id="${esc(entry.id||'')}"><div class="grid"><label>Cliente<select name="clientId" required>${clients.map(c=>`<option value="${esc(c.id)}" ${String(entry.clientId||presetClient)===String(c.id)?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label><label>Data<input type="date" name="referenceDate" value="${esc(entry.referenceDate||isoToday())}" required></label><label>XP inicial<input type="text" inputmode="numeric" autocomplete="off" data-xp-format name="xpInitial" value="${esc(formatXPInput(entry.xpInitial??0))}" required></label><label>XP final<input type="text" inputmode="numeric" autocomplete="off" data-xp-format name="xpFinal" value="${esc(formatXPInput(entry.xpFinal??0))}" required></label><label>Situação do dia<select name="dayStatus"><option value="worked" ${entry.dayStatus!=='no_activity'?'selected':''}>Com atividade</option><option value="no_activity" ${entry.dayStatus==='no_activity'?'selected':''}>Sem atividade</option></select></label><label class="full">Observação<textarea name="notes" rows="3" maxlength="500">${esc(entry.notes||'')}</textarea></label></div><p class="note">O registro será associado ao cliente escolhido. XP feito é XP final menos XP inicial.</p><div class="form-actions"><button type="button" class="secondary" data-action="close-modal">Cancelar</button><button class="primary" type="submit">${isEdit?'Salvar registro':'Cadastrar XP'}</button></div></form>`:emptyState('Cadastre um cliente primeiro','A apuração precisa estar vinculada a um cliente.',`<button class="primary" data-action="new-customer">Cadastrar cliente</button>`)}</section></div>`;
  }
  function cycleForm(cycle = {}, presetClient = '') {
    const isEdit = Boolean(cycle.id);
    const clients = activeCustomers().filter(c=>c.status==='active');
    return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button class="modal-close" data-action="close-modal" aria-label="Fechar">×</button><span class="eyebrow">CICLO DE APURAÇÃO</span><h2 id="modal-title">${isEdit?'Editar ciclo':'Abrir ciclo'}</h2>${clients.length?`<form class="form" id="cycle-form" data-id="${esc(cycle.id||'')}"><div class="grid"><label>Cliente<select name="clientId" required>${clients.map(c=>`<option value="${esc(c.id)}" ${String(cycle.clientId||presetClient)===String(c.id)?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label><label>Status<select name="status"><option value="open" ${cycle.status!=='closed'&&cycle.status!=='paid'?'selected':''}>Aberto</option><option value="closed" ${cycle.status==='closed'?'selected':''}>Fechado</option></select></label><label>Data inicial<input type="date" name="startDate" value="${esc(cycle.startDate||isoToday())}" required></label><label>Data final<input type="date" name="endDate" value="${esc(cycle.endDate||isoToday())}" required></label><label>Taxa por unidade em R$<input type="number" name="rateBrlPer1000Xp" min="0" step="0.01" value="${esc(cycle.rateBrlPer1000Xp ?? customerById(cycle.clientId||presetClient)?.rateBrlPer1000Xp ?? 1.2)}" required></label><label>Meta do ciclo<input type="number" name="targetValue" min="0" step="0.01" value="${esc(cycle.targetValue||'')}" placeholder="Opcional"></label><label>Unidade da meta<select name="targetUnit"><option value="brl" ${cycle.targetUnit!=='xp'?'selected':''}>R$</option><option value="xp" ${cycle.targetUnit==='xp'?'selected':''}>XP</option></select></label></div><div class="form-actions"><button type="button" class="secondary" data-action="close-modal">Cancelar</button><button class="primary" type="submit">${isEdit?'Salvar ciclo':'Criar ciclo'}</button></div></form>`:emptyState('Cadastre um cliente primeiro','O ciclo precisa estar vinculado a um cliente.',`<button class="primary" data-action="new-customer">Cadastrar cliente</button>`)}</section></div>`;
  }
  function paymentForm(cycle) {
    const total = cycleTotals(cycle).total;
    return `<div class="modal-backdrop"><section class="modal narrow" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button class="modal-close" data-action="close-modal" aria-label="Fechar">×</button><span class="eyebrow">REGISTRAR PAGAMENTO</span><h2 id="modal-title">Confirmar pagamento</h2><p class="muted">Este registro atualiza o status do ciclo. Nenhuma transferência será feita.</p><form class="form" id="payment-form" data-id="${esc(cycle.id)}"><label>Valor pago em R$<input name="paidAmountBrl" type="number" min="0" step="0.01" value="${total.toFixed(2)}" required></label><label>Data do pagamento<input name="paidAt" type="date" value="${isoToday()}" required></label><div class="form-actions"><button type="button" class="secondary" data-action="close-modal">Cancelar</button><button class="primary" type="submit">Marcar como pago</button></div></form></section></div>`;
  }
  function renderModal() {
    if (!state.modal) return '';
    const m = state.modal;
    if (m.type==='client') return clientForm(m.data || {});
    if (m.type==='customer') return customerForm(m.data || {});
    if (m.type==='entry') return entryForm(m.data || {}, m.clientId || '');
    if (m.type==='cycle') return cycleForm(m.data || {}, m.clientId || '');
    if (m.type==='payment') return paymentForm(m.data);
    return '';
  }
  function openModal(type, data = {}, clientId = '') { state.modal = { type, data, clientId }; render(); }
  function closeModal() { state.modal = null; render(); }

  async function saveClient(form) {
    const f = new FormData(form); const existing = form.dataset.id ? clientById(form.dataset.id) : null;
    const initialPassword = String(f.get('initialPassword') || '');
    const passwordConfirm = String(f.get('passwordConfirm') || '');
    const data = { name: String(f.get('name')).trim(), nickname: String(f.get('nickname')).trim(), email: String(f.get('email')).trim().toLowerCase(), status: f.get('status') };
    if (!data.name || !data.nickname || !data.email) return notify('Confira os campos do cadastro.', true);
    if ((!existing || initialPassword) && initialPassword.length < 8) return notify('A senha provisória precisa ter pelo menos 8 caracteres.', true);
    if ((!existing || initialPassword) && initialPassword !== passwordConfirm) return notify('As senhas provisórias não conferem.', true);
    if (existing && !initialPassword && passwordConfirm) return notify('Preencha a nova senha provisória ou deixe os dois campos vazios.', true);
    const duplicate = state.clients.some(c=>c.email?.toLowerCase()===data.email && String(c.id)!==String(existing?.id));
    if (duplicate) return notify('Já existe um serviceiro com esse e-mail.', true);
    try {
      if (API_MODE) {
        const payload = { ...data };
        if (initialPassword) { payload.initialPassword = initialPassword; payload.mustChangePassword = true; }
        if (existing) await api(`/admin/serviceiros/${encodeURIComponent(existing.id)}`, 'PATCH', payload);
        else await api('/admin/serviceiros', 'POST', { ...payload, mustChangePassword: true });
        await loadApiData(true);
      } else if (existing) {
        Object.assign(existing, data, { updatedAt: new Date().toISOString() });
        if (initialPassword) { const credential = await hashPassword(initialPassword); existing.passwordSalt=credential.salt; existing.passwordHash=credential.hash; existing.mustChangePassword=true; }
      } else {
        const credential = await hashPassword(initialPassword);
        state.clients.push({ id: id(), ...data, passwordSalt: credential.salt, passwordHash: credential.hash, mustChangePassword: true, accessStatus: 'active', createdAt: new Date().toISOString() });
      }
      saveDemoData(); state.modal = null; render();
      notify(existing ? (initialPassword ? 'Senha provisória redefinida; a troca será exigida no próximo acesso.' : 'Cadastro atualizado.') : 'Acesso criado com senha provisória. O serviceiro trocará a senha no primeiro login.');
    } catch (error) { notify(error.message, true); }
  }
  async function saveCustomer(form) {
    const f = new FormData(form); const existing = form.dataset.id ? customerById(form.dataset.id) : null;
    const data = { name:String(f.get('name')).trim(), nickname:String(f.get('nickname')||'').trim(), email:String(f.get('email')||'').trim().toLowerCase(), phone:String(f.get('phone')||'').trim(), status:f.get('status'), xpPerBillingUnit:Number(f.get('xpPerBillingUnit')), rateBrlPer1000Xp:Number(f.get('rateBrlPer1000Xp')), cycleType:f.get('cycleType'), targetValue:Number(f.get('targetValue')||0), targetUnit:f.get('targetUnit'), initialPassword:String(f.get('initialPassword')||''), passwordConfirm:String(f.get('passwordConfirm')||'') };
    if (!data.name || ![1,1000].includes(data.xpPerBillingUnit) || data.rateBrlPer1000Xp<0) return notify('Confira os campos do cliente e a forma de cálculo do XP.',true);
    const duplicate = visibleCustomers().some(c=>data.email && c.email?.toLowerCase()===data.email && String(c.id)!==String(existing?.id));
    if (duplicate) return notify('Já existe um cliente com esse e-mail.',true);
    try {
      if (API_MODE) {
        if (existing) await api(`/serviceiro/clientes/${encodeURIComponent(existing.id)}`,'PATCH',data);
        else await api('/serviceiro/clientes','POST',data);
        await loadApiData(true);
      } else if (existing) Object.assign(existing,data,{updatedAt:new Date().toISOString()});
      else state.customers.push({id:id(),...data,serviceiroId:state.me.id,createdAt:new Date().toISOString()});
      saveDemoData(); state.modal=null; render(); notify(existing?'Cliente atualizado.':'Cliente cadastrado.');
    } catch(error) { notify(error.message,true); }
  }
  async function changeCustomerStatus(customer,status) {
    const label=status==='archived'?'arquivar':status==='active'?'reativar':'desativar';
    if(!confirm(`Deseja ${label} ${customer.name}? O histórico será preservado.`)) return;
    try {
      if(API_MODE) await api(`/serviceiro/clientes/${encodeURIComponent(customer.id)}`,status==='archived'?'DELETE':'PATCH',status==='archived'?undefined:{status});
      else customer.status=status;
      if(API_MODE) await loadApiData(true); else saveDemoData();
      render(); notify(status==='archived'?'Cliente arquivado.':'Situação do cliente atualizada.');
    } catch(error) { notify(error.message,true); }
  }
  async function saveEntry(form) {
    const f = new FormData(form); const existing = form.dataset.id ? state.entries.find(e=>String(e.id)===String(form.dataset.id)) : null;
    const data = { clientId: f.get('clientId'), referenceDate: f.get('referenceDate'), xpInitial: parseXP(f.get('xpInitial')), xpFinal: parseXP(f.get('xpFinal')), dayStatus: f.get('dayStatus'), notes: String(f.get('notes')||'').trim() };
    if (!data.referenceDate || data.xpInitial < 0 || data.xpFinal < 0) return notify('Informe uma data e valores de XP válidos.', true);
    if (data.dayStatus==='worked' && data.xpFinal < data.xpInitial) return notify('XP final não pode ser menor que XP inicial.', true);
    if (data.dayStatus==='no_activity') data.xpInitial = data.xpFinal = 0;
    const duplicate = activeEntries().some(e=>String(e.clientId)===String(data.clientId) && e.referenceDate===data.referenceDate && String(e.id)!==String(existing?.id));
    if (duplicate) return notify('Já existe uma apuração para este cliente nesta data.', true);
    try {
      if (API_MODE) {
        if (existing) await api(`/serviceiro/apuracoes/${encodeURIComponent(existing.id)}`, 'PATCH', data);
        else await api('/serviceiro/apuracoes', 'POST', data);
        await loadApiData(true);
      } else if (existing) Object.assign(existing, data, { updatedAt: new Date().toISOString() });
      else state.entries.push({ id: id(), ...data, serviceiroId:state.me.id, createdAt: new Date().toISOString() });
      saveDemoData(); state.modal=null; render(); notify(existing?'Apuração atualizada.':'Apuração lançada.');
    } catch (error) { notify(error.message, true); }
  }
  async function saveCycle(form) {
    const f = new FormData(form); const existing = form.dataset.id ? state.cycles.find(c=>String(c.id)===String(form.dataset.id)) : null;
    const data = { clientId:f.get('clientId'), status:f.get('status'), startDate:f.get('startDate'), endDate:f.get('endDate'), rateBrlPer1000Xp:Number(f.get('rateBrlPer1000Xp')), targetValue:Number(f.get('targetValue')||0), targetUnit:f.get('targetUnit') };
    if (!data.startDate || !data.endDate || data.startDate>data.endDate || data.rateBrlPer1000Xp<0) return notify('Confira o período e a taxa do ciclo.', true);
    const overlap = activeCycles().some(c=>String(c.clientId)===String(data.clientId) && c.status==='open' && c.id!==existing?.id && data.startDate<=c.endDate && data.endDate>=c.startDate);
    if (overlap) return notify('Já existe um ciclo aberto que cruza esse período.', true);
    try {
      if (API_MODE) {
        if (existing) await api(`/serviceiro/ciclos/${encodeURIComponent(existing.id)}`, 'PATCH', data);
        else await api('/serviceiro/ciclos', 'POST', data);
        await loadApiData(true);
      } else if (existing) Object.assign(existing, data, { updatedAt:new Date().toISOString() });
      else state.cycles.push({ id:id(), ...data, serviceiroId:state.me.id, createdAt:new Date().toISOString() });
      saveDemoData(); state.modal=null; render(); notify(existing?'Ciclo atualizado.':'Ciclo criado.');
    } catch (error) { notify(error.message, true); }
  }
  async function changeClientStatus(client, status) {
    const label = status==='archived'?'arquivar':'desativar';
    if (!confirm(`Deseja ${label} ${client.name}? O histórico será preservado.`)) return;
    try {
      if (API_MODE) await api(`/admin/serviceiros/${encodeURIComponent(client.id)}`, status==='archived'?'DELETE':'PATCH', status==='archived'?undefined:{ status });
      else client.status = status;
      if (API_MODE) await loadApiData(true); else saveDemoData();
      render(); notify(status==='archived'?'Cadastro arquivado.':'Situação atualizada.');
    } catch (error) { notify(error.message, true); }
  }
  async function deleteEntry(entry) {
    if (!confirm(`Excluir logicamente a apuração de ${fmtDate(entry.referenceDate)}?`)) return;
    try {
      if (API_MODE) await api(`/serviceiro/apuracoes/${encodeURIComponent(entry.id)}`, 'DELETE');
      else entry.deletedAt = new Date().toISOString();
      if (API_MODE) await loadApiData(true); else saveDemoData();
      render(); notify('Apuração excluída do histórico ativo.');
    } catch (error) { notify(error.message, true); }
  }
  async function deleteCycle(cycle) {
    if (!confirm(`Arquivar o ciclo de ${fmtDate(cycle.startDate)} a ${fmtDate(cycle.endDate)}? O histórico será preservado.`)) return;
    try {
      if (API_MODE) await api(`/serviceiro/ciclos/${encodeURIComponent(cycle.id)}`, 'DELETE');
      else cycle.deletedAt = new Date().toISOString();
      if (API_MODE) await loadApiData(true); else saveDemoData();
      render(); notify('Ciclo arquivado.');
    } catch (error) { notify(error.message, true); }
  }
  async function updateCycle(cycle, data) {
    try {
      if (API_MODE) await api(`/serviceiro/ciclos/${encodeURIComponent(cycle.id)}`, 'PATCH', data);
      else Object.assign(cycle, data, { updatedAt:new Date().toISOString() });
      if (API_MODE) await loadApiData(true); else saveDemoData();
      state.modal=null; render(); notify('Status do ciclo atualizado.');
    } catch (error) { notify(error.message, true); }
  }

  app.addEventListener('click', async event => {
    const button = event.target.closest('[data-action]'); if (!button) return;
    const action = button.dataset.action; const targetId = button.dataset.id;
    if (action==='serviceiro-login') { state.loginMode='serviceiro'; renderLogin(); return; }
    if (action==='admin-login' || action==='client-login') { state.loginMode='client'; renderLogin(); return; }
    if (action==='register-serviceiro') { renderServiceiroRegistration(); return; }
    if (action==='reset-password') { const email = String(document.querySelector('#login-form input[name="email"]')?.value || '').trim(); if (!email) return notify('Informe seu e-mail no campo de login primeiro.', true); try { await window.PainelFirebase.auth.sendPasswordResetEmail(email); notify('Se a conta existir, o Firebase enviará as instruções de recuperação por e-mail.'); } catch (error) { notify(error.message || 'Não foi possível iniciar a recuperação.', true); } return; }
    if (action==='cancel-registration') { state.loginMode='serviceiro'; renderLogin(); return; }
    if (action==='demo-login') { state.me={id:'demo-admin',role:'admin',name:'Administrador'}; state.view='dashboard'; render(); return; }
    if (action==='logout') { await logout(); return; }
    if (action==='nav') { state.view=button.dataset.view; state.query=''; render(); return; }
    if (action==='new-client') { openModal('client'); return; }
    if (action==='edit-client') { const c=clientById(targetId); if(c)openModal('client',c); return; }
    if (action==='client-detail') { state.currentClientId=targetId; state.view='client-detail'; render(); return; }
    if (action==='deactivate-client') { const c=clientById(targetId); if(c)await changeClientStatus(c,'inactive'); return; }
    if (action==='reactivate-client') { const c=clientById(targetId); if(!c)return; if(API_MODE) { try{await api(`/admin/serviceiros/${encodeURIComponent(c.id)}`,'PATCH',{status:'active'});await loadApiData(true);}catch(e){return notify(e.message,true);} } else c.status='active'; saveDemoData(); render(); notify('Serviceiro ativado.'); return; }
    if (action==='archive-client') { const c=clientById(targetId); if(c)await changeClientStatus(c,'archived'); return; }
    if (action==='new-customer') { openModal('customer'); return; }
    if (action==='edit-customer') { const c=customerById(targetId); if(c)openModal('customer',c); return; }
    if (action==='deactivate-customer') { const c=customerById(targetId); if(c)await changeCustomerStatus(c,'inactive'); return; }
    if (action==='reactivate-customer') { const c=customerById(targetId); if(c)await changeCustomerStatus(c,'active'); return; }
    if (action==='archive-customer') { const c=customerById(targetId); if(c)await changeCustomerStatus(c,'archived'); return; }
    if (action==='new-entry') { openModal('entry',{},button.dataset.clientId||''); return; }
    if (action==='edit-entry') { const e=state.entries.find(x=>String(x.id)===String(targetId)); if(e)openModal('entry',e); return; }
    if (action==='delete-entry') { const e=state.entries.find(x=>String(x.id)===String(targetId)); if(e)await deleteEntry(e); return; }
    if (action==='new-cycle') { openModal('cycle',{},button.dataset.clientId||''); return; }
    if (action==='edit-cycle') { const c=state.cycles.find(x=>String(x.id)===String(targetId)); if(c)openModal('cycle',c); return; }
    if (action==='close-cycle') { const c=state.cycles.find(x=>String(x.id)===String(targetId)); if(c&&confirm('Fechar este ciclo? Os totais serão congelados para conferência.'))await updateCycle(c,{status:'closed'}); return; }
    if (action==='mark-paid') { const c=state.cycles.find(x=>String(x.id)===String(targetId)); if(c)openModal('payment',c); return; }
    if (action==='delete-cycle') { const c=state.cycles.find(x=>String(x.id)===String(targetId)); if(c&&c.status!=='paid')await deleteCycle(c); return; }
    if (action==='preview-client') { state.currentClientId=targetId; state.view='portal'; state.preview=true; render(); return; }
    if (action==='back-to-admin') { state.preview=false; state.view='client-detail'; render(); return; }
    if (action==='backdrop' && event.target===button) { closeModal(); return; }
    if (action==='close-modal') { closeModal(); return; }
    if (action==='clear-entry-filters') { state.entryClient='all';state.entryFrom='';state.entryTo='';render();return; }
  });
  app.addEventListener('submit', async event => {
    event.preventDefault(); const form=event.target;
    if(form.id==='login-form') {
      const f=new FormData(form); try { await login(String(f.get('email')).trim(),String(f.get('password')),form.dataset.role || 'any'); } catch(error) { state.me=null; renderLogin(error.message); }
    }
    if(form.id==='serviceiro-registration-form') {
      const f=new FormData(form); const password=String(f.get('password')||''); const confirmPassword=String(f.get('passwordConfirm')||'');
      if(password.length<8 || password!==confirmPassword) return renderServiceiroRegistration('Use uma senha com pelo menos 8 caracteres e confirme corretamente.');
      try { await window.PainelFirebase.registerServiceiro({name:String(f.get('name')).trim(),nickname:String(f.get('nickname')||'').trim(),email:String(f.get('email')).trim(),password}); state.me=await api('/me'); await loadApiData(); render(); notify('Conta de Serviceiro criada.'); } catch(error) { renderServiceiroRegistration(error.message); }
    }
    if(form.id==='password-change-form') {
      const f=new FormData(form); const password=String(f.get('password')||''); const confirmation=String(f.get('passwordConfirm')||'');
      if (password.length<8) return renderPasswordChange('A senha precisa ter pelo menos 8 caracteres.');
      if (password!==confirmation) return renderPasswordChange('As senhas não conferem. Tente novamente.');
      try {
        if (API_MODE) await api('/auth/password','POST',{ newPassword: password });
        else {
          const user=state.clients.find(c=>String(c.id)===String(state.me.id));
          if (!user) throw new Error('Não foi possível localizar a conta de demonstração.');
          const credential=await hashPassword(password); user.passwordSalt=credential.salt; user.passwordHash=credential.hash; user.mustChangePassword=false; saveDemoData();
        }
        state.me.mustChangePassword=false; if (API_MODE) await loadApiData(); state.view='dashboard'; render(); notify('Senha atualizada. Bem-vindo ao painel.');
      } catch(error) { renderPasswordChange(error.message); }
    }
    if(form.id==='client-form') await saveClient(form);
    if(form.id==='customer-form') await saveCustomer(form);
    if(form.id==='entry-form') await saveEntry(form);
    if(form.id==='cycle-form') await saveCycle(form);
    if(form.id==='payment-form') { const f=new FormData(form); const c=state.cycles.find(x=>String(x.id)===String(form.dataset.id)); if(c)await updateCycle(c,{status:'paid',paidAmountBrl:Number(f.get('paidAmountBrl')),paidAt:f.get('paidAt')}); }
  });
  app.addEventListener('input', event => {
    if (event.target.matches('input[data-xp-format]')) {
      const el = event.target;
      const formatted = formatXPInput(el.value);
      if (el.value !== formatted) { el.value = formatted; el.setSelectionRange(formatted.length, formatted.length); }
      return;
    }
    if(event.target.id==='client-search') { state.query=event.target.value; const cursor=event.target.selectionStart; render(); const input=document.querySelector('#client-search'); input?.focus(); input?.setSelectionRange(cursor,cursor); }
  });
  app.addEventListener('change', event => {
    const el=event.target;
    if(el.id==='client-status') { state.clientStatus=el.value; render(); }
    if(el.id==='entry-client') { state.entryClient=el.value; render(); }
    if(el.id==='entry-from') { state.entryFrom=el.value; render(); }
    if(el.id==='entry-to') { state.entryTo=el.value; render(); }
    if(el.id==='cycle-status') { state.cycleStatus=el.value; render(); }
  });
  document.addEventListener('keydown', event => { if(event.key==='Escape'&&state.modal)closeModal(); });

  async function start() {
    if (window.PainelFirebase?.enabled) {
      window.PainelFirebase.auth.onAuthStateChanged(async user => {
        if (!user) { state.me = null; state.view = 'login'; render(); return; }
        try {
          state.me = await api('/me');
          if (state.me.mustChangePassword) { state.view='password-change'; render(); return; }
          await loadApiData(); render();
        } catch (error) { state.me = null; state.view='login'; renderLogin(error.message); }
      });
      return;
    }
    if (!API_MODE) { renderLogin('Não foi possível inicializar o Firebase. Verifique a internet, a configuração e as regras do projeto.'); return; }
    try { state.me = await api('/me'); await loadApiData(); } catch (_) { state.me = null; }
    render();
  }
  start();
})();
