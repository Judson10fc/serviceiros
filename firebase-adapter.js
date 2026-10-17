/* Adaptador Firebase para Painel XP: Authentication + Realtime Database, sem Cloud Functions. */
(() => {
  'use strict';
  const cfg = window.PAINEL_CONFIG?.firebaseConfig;
  if (!cfg?.apiKey || !cfg?.databaseURL || !window.firebase) {
    window.PainelFirebase = { enabled: false, error: 'A configuração do Firebase não foi carregada.' };
    return;
  }
  const app = firebase.apps.find(a => a.name === '[DEFAULT]') || firebase.initializeApp(cfg);
  const auth = app.auth();
  const db = app.database();
  const now = () => new Date().toISOString();
  const clean = o => Object.fromEntries(Object.entries(o || {}).filter(([,v]) => v !== undefined));
  const uid = () => auth.currentUser?.uid;
  const val = async path => (await db.ref(path).get()).val();
  const objList = value => value ? Object.entries(value).map(([id, item]) => ({ id, ...item })) : [];
  const rootProfile = async () => {
    if (!uid()) throw new Error('Sua sessão expirou. Entre novamente.');
    const profile = await val(`users/${uid()}`);
    if (!profile || profile.status === 'archived' || profile.status === 'inactive') throw new Error('Conta não encontrada ou desativada.');
    return { id: uid(), ...profile };
  };
  const customerPath = (serviceiroUid, clientUid) => `serviceiroData/${serviceiroUid}/customers/${clientUid}`;
  async function createCustomer(data) {
    const serviceiro = await rootProfile();
    if (serviceiro.role !== 'serviceiro') throw new Error('Somente Serviceiros podem cadastrar clientes.');
    const email = String(data.email || '').trim().toLowerCase();
    if (!email) throw new Error('Informe um e-mail para o Cliente entrar no sistema e recuperar o acesso.');
    const password = String(data.initialPassword || '');
    if (password.length < 8 || password !== String(data.passwordConfirm || '')) throw new Error('A senha provisória deve ter ao menos 8 caracteres e as confirmações devem ser iguais.');
    const secondaryName = `customer-${serviceiro.id}-${Date.now()}`;
    const secondary = firebase.initializeApp(cfg, secondaryName);
    try {
      const credential = await secondary.auth().createUserWithEmailAndPassword(email, password);
      const clientUid = credential.user.uid;
      const profile = {
        role: 'client', name: String(data.name).trim(), nickname: String(data.nickname || '').trim(),
        email, phone: String(data.phone || '').trim(), status: data.status || 'active',
        serviceiroUid: serviceiro.id, xpPerBillingUnit: Number(data.xpPerBillingUnit || 1000),
        rateBrlPer1000Xp: Number(data.rateBrlPer1000Xp || 0), cycleType: data.cycleType || 'Semanal',
        targetValue: Number(data.targetValue || 0), targetUnit: data.targetUnit || 'brl', createdAt: now()
      };
      // The secondary Auth instance is authenticated as the newly-created client, so its profile is self-written.
      await secondary.database().ref(`users/${clientUid}`).set(profile);
      await secondary.database().ref(`clientData/${clientUid}/profile`).set({ ...profile, uid: clientUid });
      await secondary.auth().signOut();
      await db.ref(customerPath(serviceiro.id, clientUid)).set({ ...profile, id: clientUid, serviceiroId: serviceiro.id, clientUid });
      await db.ref(`serviceiroData/${serviceiro.id}/clientIndex/${clientUid}`).set(true);
      return { ...profile, id: clientUid, clientUid, serviceiroId: serviceiro.id };
    } catch (error) {
      const code = error?.code || '';
      if (code === 'auth/email-already-in-use') throw new Error('Este e-mail já está cadastrado no Firebase Authentication.');
      if (code === 'auth/weak-password') throw new Error('A senha precisa ter pelo menos 6 caracteres no Firebase; neste painel exigimos 8.');
      throw error;
    } finally {
      try { await secondary.delete(); } catch (_) {}
    }
  }
  async function mirrorClientData(serviceiroUid, clientUid, entity, data) {
    const updates = {};
    updates[`serviceiroData/${serviceiroUid}/${entity}/${data.id}`] = data.deletedAt ? data : data;
    updates[`clientData/${clientUid}/${entity}/${data.id}`] = data;
    await db.ref().update(updates);
  }
  async function route(path, method = 'GET', body) {
    if (path === '/auth/session' && method === 'POST') {
      const email = String(body?.email || '').trim().toLowerCase();
      await auth.signInWithEmailAndPassword(email, String(body?.password || ''));
      const profile = await rootProfile();
      return profile;
    }
    if (path === '/auth/session' && method === 'DELETE') { await auth.signOut(); return { ok: true }; }
    if (path === '/me' && method === 'GET') return rootProfile();
    if (path === '/auth/password' && method === 'POST') {
      const user = auth.currentUser; if (!user) throw new Error('Entre novamente para alterar a senha.');
      await user.updatePassword(String(body?.newPassword || ''));
      await db.ref(`users/${user.uid}/mustChangePassword`).set(false);
      return { ok: true };
    }
    const profile = await rootProfile();
    const isClient = profile.role === 'client';
    const isServiceiro = profile.role === 'serviceiro';
    if (path === '/serviceiro/resumo' && method === 'GET') {
      if (!isServiceiro) throw new Error('Apenas Serviceiros podem abrir esta área.');
      return { serviceiro: { ...profile, id: profile.id } };
    }
    if (path === '/serviceiro/clientes' && method === 'GET') {
      if (!isServiceiro) throw new Error('Apenas Serviceiros podem listar clientes.');
      return objList(await val(`serviceiroData/${profile.id}/customers`));
    }
    if (path === '/serviceiro/clientes' && method === 'POST') return createCustomer(body || {});
    let m = path.match(/^\/serviceiro\/clientes\/([^/]+)$/);
    if (m) {
      if (!isServiceiro) throw new Error('Apenas Serviceiros podem alterar clientes.');
      const clientUid = decodeURIComponent(m[1]);
      const current = await val(customerPath(profile.id, clientUid));
      if (!current) throw new Error('Cliente não encontrado neste Serviceiro.');
      if (method === 'PATCH') {
        const next = { ...current, ...clean(body), updatedAt: now() };
        // Do not permit changing account identity or serviceiro ownership from the profile form.
        next.id = clientUid; next.clientUid = clientUid; next.serviceiroId = profile.id; next.serviceiroUid = profile.id;
        await db.ref(customerPath(profile.id, clientUid)).update(next);
        await db.ref(`users/${clientUid}`).update(clean({ name: next.name, nickname: next.nickname, phone: next.phone, status: next.status, xpPerBillingUnit: next.xpPerBillingUnit, rateBrlPer1000Xp: next.rateBrlPer1000Xp, cycleType: next.cycleType, targetValue: next.targetValue, targetUnit: next.targetUnit, updatedAt: now() }));
        await db.ref(`clientData/${clientUid}/profile`).update(clean({ name: next.name, nickname: next.nickname, phone: next.phone, status: next.status, xpPerBillingUnit: next.xpPerBillingUnit, rateBrlPer1000Xp: next.rateBrlPer1000Xp, cycleType: next.cycleType, targetValue: next.targetValue, targetUnit: next.targetUnit, updatedAt: now() }));
        return next;
      }
      if (method === 'DELETE') {
        await db.ref(customerPath(profile.id, clientUid)).update({ status: 'archived', archivedAt: now() });
        await db.ref(`users/${clientUid}/status`).set('archived');
        await db.ref(`clientData/${clientUid}/profile/status`).set('archived');
        await db.ref(`serviceiroData/${profile.id}/clientIndex/${clientUid}`).remove();
        return { ok: true };
      }
    }
    if (path === '/serviceiro/apuracoes' && method === 'GET') {
      if (isServiceiro) return objList(await val(`serviceiroData/${profile.id}/entries`));
      if (isClient) return objList(await val(`clientData/${profile.id}/entries`));
    }
    if (path === '/serviceiro/ciclos' && method === 'GET') {
      if (isServiceiro) return objList(await val(`serviceiroData/${profile.id}/cycles`));
      if (isClient) return objList(await val(`clientData/${profile.id}/cycles`));
    }
    m = path.match(/^\/serviceiro\/(apuracoes|ciclos)(?:\/([^/]+))?$/);
    if (m) {
      if (!isServiceiro) throw new Error('O Cliente tem acesso somente para consulta.');
      const entity = m[1] === 'apuracoes' ? 'entries' : 'cycles';
      const id = m[2] ? decodeURIComponent(m[2]) : (body?.id || db.ref().push().key);
      if (method === 'POST' || method === 'PATCH') {
        const clientUid = String(body?.clientId || body?.clientUid || '');
        const customer = await val(customerPath(profile.id, clientUid));
        if (!customer || customer.status === 'archived') throw new Error('Selecione um cliente ativo deste Serviceiro.');
        const current = method === 'PATCH' ? await val(`serviceiroData/${profile.id}/${entity}/${id}`) : null;
        if (method === 'PATCH' && (!current || current.serviceiroId !== profile.id)) throw new Error('Registro não encontrado ou sem permissão.');
        const record = { ...(current || {}), ...clean(body), id, clientId: clientUid, clientUid, serviceiroId: profile.id, serviceiroUid: profile.id, createdAt: current?.createdAt || now(), updatedAt: now() };
        const updates = {};
        updates[`serviceiroData/${profile.id}/${entity}/${id}`] = record;
        updates[`clientData/${clientUid}/${entity}/${id}`] = record;
        await db.ref().update(updates);
        return record;
      }
      if (method === 'DELETE') {
        const current = await val(`serviceiroData/${profile.id}/${entity}/${id}`);
        if (!current || current.serviceiroId !== profile.id) throw new Error('Registro não encontrado ou sem permissão.');
        const record = { ...current, status: 'deleted', deletedAt: now(), updatedAt: now() };
        const updates = {};
        updates[`serviceiroData/${profile.id}/${entity}/${id}`] = record;
        updates[`clientData/${current.clientId}/${entity}/${id}`] = record;
        await db.ref().update(updates); return { ok: true };
      }
    }
    throw new Error(`Operação não suportada pelo Firebase sem servidor: ${method} ${path}`);
  }
  window.PainelFirebase = {
    enabled: true, auth, db, route,
    async registerServiceiro({ name, nickname, email, password }) {
      const credential = await auth.createUserWithEmailAndPassword(String(email).trim().toLowerCase(), password);
      const profile = { role: 'serviceiro', name: String(name).trim(), nickname: String(nickname || '').trim(), email: String(email).trim().toLowerCase(), status: 'active', createdAt: now() };
      await db.ref(`users/${credential.user.uid}`).set(profile);
      return { id: credential.user.uid, ...profile };
    },
    async loadClientPortal() {
      const p = await rootProfile(); if (p.role !== 'client') throw new Error('Esta conta não é de Cliente.');
      const [entries, cycles] = await Promise.all([val(`clientData/${p.id}/entries`), val(`clientData/${p.id}/cycles`)]);
      return { profile: p, customers: [{ ...p, id: p.id, serviceiroId: p.serviceiroUid }], entries: objList(entries), cycles: objList(cycles) };
    }
  };
  auth.onAuthStateChanged(user => { window.dispatchEvent(new CustomEvent('painelxp-auth-ready', { detail: { signedIn: Boolean(user), uid: user?.uid || null } })); });
})();
