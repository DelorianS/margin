// Settings modal (local LLM + behaviour), capture-bookmarklet guide, and the LLM status pill.
import { api } from './api.js';
import { h, icon, modal, toast, fill } from './ui.js';
import { bus, llm, refreshLlm } from './app.js';
import { openNetworkGuide } from './network.js';
import { isNativeApp } from './connection.js';
import { openDeviceSettings } from './device.js';

export function llmPill() {
  const label = h('span');
  const el = h('button', { class: 'llm-pill', onclick: openSettings, title: 'AI settings' }, h('i', { class: 'dot' }), label);
  const update = (s) => {
    el.classList.toggle('ok', !!s?.ok);
    el.classList.toggle('bad', !!s && !s.ok);
    label.textContent = !s ? 'Checking AI…' : s.ok ? (s.model || 'Choose a model') : 'AI unavailable';
    el.title = s?.ok ? `${s.provider === 'openrouter' ? 'OpenRouter' : s.provider === 'openai' ? 'OpenAI-compatible' : 'Ollama'} · ${s.baseUrl}` : (s?.error || '');
  };
  update(llm.status);
  const off = bus.on('llm', update);
  el._cleanup = off;
  return el;
}

export async function openSettings() {
  let s;
  try { s = await api.get('/api/settings'); } catch (e) {
    if (isNativeApp()) { openDeviceSettings(); return; }
    toast(e.message, { type: 'error' }); return;
  }
  const status = h('div', { class: 'callout' });
  const modelSel = h('select', { class: 'select', id: 'set-model' });
  const provider = h('div', { class: 'segmented' });
  const baseUrl = h('input', { class: 'input', id: 'set-base', value: s.llmBaseUrl, placeholder: 'http://localhost:11434' });
  const apiKey = h('input', { class: 'input', id: 'set-key', type: 'password', value: s.llmApiKey || '', placeholder: 'Optional', autocomplete: 'off' });
  const keyField = h('div', { class: 'field' }, h('label', { for: 'set-key' }, 'API key'), apiKey);
  const cloudNotice = h('div', { class: 'callout', hidden: true }, icon('info', 'sm'), h('span', null, 'OpenRouter sends chapter excerpts, questions and model notes to OpenRouter and the selected model provider. Usage may cost credits. Automatic chapter analysis also uses this provider when enabled. Test checks your key and model list without generating a response.'));
  if (s.apiKeyManagedOnPC) { apiKey.disabled = true; apiKey.placeholder = 'Managed on your PC'; }
  const temp = h('input', { type: 'range', min: 0, max: 1.2, step: 0.05, value: s.temperature });
  const tempOut = h('output', null, Number(s.temperature).toFixed(2));
  temp.oninput = () => { tempOut.textContent = Number(temp.value).toFixed(2); };
  const ctx = h('select', { class: 'select', id: 'set-ctx' }, [4096, 8192, 16384, 32768, 65536].map(n => h('option', { value: n, selected: n === Number(s.contextWindow) }, `${n / 1024}K tokens`)));
  const autoAnalyze = h('input', { type: 'checkbox', checked: !!s.autoAnalyze });
  const adaptive = h('input', { type: 'checkbox', checked: s.analysisAdaptiveContext !== false });
  const analysisLimit = h('select', { class: 'select', id: 'set-analysis-limit' }, [2048, 3072, 4096, 6144].map(n => h('option', { value: n, selected: n === Number(s.analysisMaxTokens || 3072) }, `${n.toLocaleString()} tokens${n === 3072 ? ' (recommended)' : ''}`)));
  const prefetch = h('input', { type: 'checkbox', checked: !!s.prefetchNext });
  const llmContext = h('textarea', { class: 'textarea', id: 'set-llmctx', rows: 4, maxlength: 4000,
    placeholder: 'e.g. Keep answers short. Use British spelling. When unsure who someone is, say so rather than guessing.' }, s.llmContext || '');
  const delay = h('input', { class: 'input', type: 'number', min: 0, max: 10000, step: 100, value: s.requestDelayMs, style: { width: '110px' } });

  let prov = s.llmProvider;
  let modelList = [], testId = 0;
  const catalogs = {};
  const drafts = {
    ollama: { base: s.llmProvider === 'ollama' ? s.llmBaseUrl : s.ollamaBaseUrl || 'http://localhost:11434', model: s.llmProvider === 'ollama' ? s.llmModel : s.providerModels?.ollama || '', key: '' },
    openai: { base: s.llmProvider === 'openai' ? s.llmBaseUrl : s.openaiBaseUrl || 'http://localhost:1234', model: s.llmProvider === 'openai' ? s.llmModel : s.providerModels?.openai || '', key: s.llmApiKey || '' },
    openrouter: { base: 'https://openrouter.ai/api/v1', model: s.llmProvider === 'openrouter' ? s.llmModel : s.providerModels?.openrouter || '', key: s.openrouterApiKey || '' },
  };
  const providerNames = { ollama: 'Ollama (local)', openai: 'OpenAI-compatible', openrouter: 'OpenRouter' };
  const defaultProvider = h('select', { class: 'select', id: 'default-provider', onchange: e => chooseProvider(e.target.value) }, Object.entries(providerNames).map(([id, label]) => h('option', { value: id, selected: s.llmProvider === id }, label)));
  const routing = Object.fromEntries(['answer', 'recap', 'analysis'].map(task => [task, { provider: 'default', model: '', ...(s.taskModels?.[task] || {}) }]));
  const taskFields = {};
  const syncDraft = () => { drafts[prov] = { base: baseUrl.value, model: modelSel.value, key: apiKey.value }; };
  const filter = h('input', { class: 'input', type: 'search', placeholder: 'Filter OpenRouter models…', 'aria-label': 'Filter OpenRouter models', oninput: () => renderModels() });
  function renderModels() {
    const current = modelSel.value || drafts[prov].model || '';
    const q = prov === 'openrouter' ? filter.value.toLowerCase() : '';
    const visible = modelList.filter(m => !q || `${m.name} ${m.details || ''}`.toLowerCase().includes(q));
    fill(modelSel, h('option', { value: '' }, prov === 'openrouter' ? 'Choose a model (Test to load models)' : 'Automatic (first available)'),
      current && !visible.some(m => m.name === current) ? h('option', { value: current, selected: true }, current) : null,
      visible.map(m => h('option', { value: m.name, selected: m.name === current }, `${m.name}${m.details ? ` · ${m.details}` : ''}`)));
  }
  modelSel.addEventListener('change', () => { drafts[prov].model = modelSel.value; });
  const chooseProvider = next => {
    syncDraft();
    prov = next; testId++; modelList = catalogs[prov] || []; filter.value = '';
    baseUrl.value = drafts[prov].base; apiKey.value = drafts[prov].key;
    fill(modelSel); renderModels(); renderProvider();
    fill(status, icon('info', 'sm'), h('span', null, 'Click Test to check this provider. Changes take effect only after Save settings.'));
  };
  const renderProvider = () => {
    fill(provider, 
      ['ollama', 'openai', 'openrouter'].map(id => h('button', { class: prov === id ? 'on' : '', onclick: () => chooseProvider(id) }, ({ ollama: 'Ollama', openai: 'OpenAI-compatible', openrouter: 'OpenRouter' })[id])),
    );
    keyField.hidden = prov === 'ollama';
    cloudNotice.hidden = prov !== 'openrouter'; filter.hidden = prov !== 'openrouter';
    baseUrl.readOnly = prov === 'openrouter';
    apiKey.placeholder = s.apiKeyManagedOnPC ? 'Managed on your PC' : prov === 'openrouter' ? 'OpenRouter API key' : 'Optional';
  };
  apiKey.value = drafts[prov].key;
  renderModels();
  renderProvider();

  const connectionFor = id => ({ llmProvider: id, llmBaseUrl: drafts[id].base.trim(), llmModel: drafts[id].model,
    ...(!s.apiKeyManagedOnPC && id === 'openrouter' ? { openrouterApiKey: drafts[id].key.trim() } : !s.apiKeyManagedOnPC && id === 'openai' ? { llmApiKey: drafts[id].key.trim() } : {}) });
  const drawTaskModels = task => {
    const route = routing[task], fields = taskFields[task];
    if (!fields) return;
    const models = catalogs[route.provider] || [];
    fields.summary.textContent = route.provider === 'default' ? 'Default provider & model' : `${providerNames[route.provider]} · ${route.model || 'Choose a model'}`;
    fill(fields.model, h('option', { value: '' }, route.provider === 'default' ? 'Use the default model' : 'Choose a model (Load models first)'),
      route.model && !models.some(m => m.name === route.model) ? h('option', { value: route.model, selected: true }, route.model) : null,
      models.map(m => h('option', { value: m.name, selected: route.model === m.name }, m.name)));
    fields.model.disabled = route.provider === 'default'; fields.context.disabled = route.provider === 'default'; fields.load.disabled = route.provider === 'default';
  };
  const taskRows = ['answer', 'recap', 'analysis'].map(task => {
    const route = routing[task];
    const model = h('select', { class: 'select', id: `task-${task}-model`, onchange: e => { route.model = e.target.value; taskFields[task].summary.textContent = `${providerNames[route.provider]} · ${route.model || 'Choose a model'}`; } });
    const context = h('select', { class: 'select', id: `task-${task}-context`, onchange: e => { route.contextWindow = Number(e.target.value) || null; } },
      h('option', { value: '', selected: !route.contextWindow }, 'Default context window'), [4096, 8192, 16384, 32768, 65536].map(n => h('option', { value: n, selected: route.contextWindow === n }, `${n / 1024}K tokens`)));
    const note = h('span', { class: 'hint', role: 'status' });
    const load = h('button', { class: 'btn sm', onclick: async () => {
      syncDraft(); const selectedProvider = route.provider;
      load.disabled = true; note.textContent = 'Loading models…';
      try {
        const result = await api.post('/api/llm/test', { ...connectionFor(selectedProvider), llmModel: '' });
        if (route.provider !== selectedProvider) return;
        catalogs[selectedProvider] = result.models || [];
        if (!result.ok) { note.textContent = result.error; return; }
        for (const id of Object.keys(taskFields)) drawTaskModels(id);
        note.textContent = `${result.models.length} models available. Choose one for this task.`;
      } catch (e) { note.textContent = e.message; }
      finally { load.disabled = route.provider === 'default'; }
    } }, 'Load models');
    const provider = h('select', { class: 'select', id: `task-${task}-provider`, onchange: e => { route.provider = e.target.value; route.model = drafts[route.provider]?.model || ''; note.textContent = ''; drawTaskModels(task); } },
      h('option', { value: 'default', selected: route.provider === 'default' }, 'Use default provider & model'), Object.entries(providerNames).map(([id, label]) => h('option', { value: id, selected: route.provider === id }, label)));
    const summary = h('span', { class: 'hint' });
    taskFields[task] = { model, context, load, summary }; drawTaskModels(task);
    return h('details', { class: 'task-model-row' }, h('summary', null, h('strong', null, ({ answer: 'Ask', recap: 'Story recaps', analysis: 'Chapter analysis & character tracking' })[task]), summary), h('div', { class: 'stack', style: { marginTop: '14px' } },
      h('div', { class: 'field' }, h('label', { for: `task-${task}-provider` }, 'Provider'), provider),
      h('div', { class: 'field' }, h('label', { for: `task-${task}-model` }, 'Model'), h('div', { class: 'row' }, h('div', { class: 'grow' }, model), load)),
      h('div', { class: 'field' }, h('label', { for: `task-${task}-context` }, 'Context window'), context), note));
  });

  const test = async () => {
    const id = ++testId;
    fill(status, h('span', { class: 'spinner' }), h('span', null, 'Connecting…'));
    try {
      syncDraft();
      const st = await api.post('/api/llm/test', connectionFor(prov));
      if (id !== testId) return;
      modelList = st.models || []; catalogs[prov] = modelList; renderModels();
      for (const task of Object.keys(taskFields)) drawTaskModels(task);
      fill(status, 
        icon(st.ok ? 'check' : 'alert', 'sm'),
        h('span', null, st.ok ? `Connected — ${modelList.length} ${prov === 'openrouter' ? 'structured-output ' : ''}model${modelList.length === 1 ? '' : 's'} available.${prov === 'openrouter' && !modelSel.value ? ' Choose one before saving.' : ''}` : `Couldn't connect: ${st.error}`),
      );
      status.style.color = st.ok ? '' : 'var(--danger)';
    } catch (e) {
      if (id !== testId) return;
      fill(status, icon('alert', 'sm'), h('span', null, e.message));
    }
  };

  const save = async (close) => {
    syncDraft();
    const selected = defaultProvider.value;
    const needsRouter = selected === 'openrouter' || Object.values(routing).some(route => route.provider === 'openrouter');
    if (needsRouter && !s.apiKeyManagedOnPC && !drafts.openrouter.key.trim()) { toast('Add your OpenRouter API key under Connections first.', { type: 'error' }); return; }
    if (selected === 'openrouter' && !drafts.openrouter.model) { toast('Choose the default OpenRouter model first.', { type: 'error' }); return; }
    if (Object.values(routing).some(route => route.provider !== 'default' && !route.model)) { toast('Choose a model for each task, or set it to Use default.', { type: 'error' }); return; }
    try {
      await api.put('/api/settings', {
        ...connectionFor(selected),
        ollamaBaseUrl: drafts.ollama.base.trim(), openaiBaseUrl: drafts.openai.base.trim(),
        providerModels: Object.fromEntries(Object.entries(drafts).map(([id, value]) => [id, value.model])), taskModels: routing,
        ...(!s.apiKeyManagedOnPC ? { llmApiKey: drafts.openai.key.trim(), openrouterApiKey: drafts.openrouter.key.trim() } : {}),
        temperature: Number(temp.value), contextWindow: Number(ctx.value), autoAnalyze: autoAnalyze.checked,
        analysisAdaptiveContext: adaptive.checked, analysisMaxTokens: Number(analysisLimit.value),
        prefetchNext: prefetch.checked, requestDelayMs: Number(delay.value) || 0, llmContext: llmContext.value.trim(),
      });
      await refreshLlm();
      toast('Settings saved', { type: 'success' });
      close();
    } catch (e) { toast(e.message, { type: 'error' }); }
  };

  const sw = (input, label, hint) => h('label', { class: 'switch', style: { alignItems: 'flex-start' } }, input, h('span', { class: 'track', style: { marginTop: '2px' } }),
    h('span', { style: { display: 'grid', gap: '2px' } }, h('span', { style: { fontWeight: 500 } }, label), h('span', { class: 'hint' }, hint)));

  modal({
    title: 'Settings',
    description: 'Choose a local model or connect OpenRouter. Your library stays on the PC.',
    body: h('div', { class: 'stack lg' },
      h('button', { class: 'btn', onclick: isNativeApp() ? openDeviceSettings : openNetworkGuide }, icon('link', 'sm'), isNativeApp() ? 'PC & saved data' : 'Read on iPad'),
      h('div', { class: 'stack' },
        h('div', { class: 'field' }, h('label', { for: 'default-provider' }, 'Default AI provider'), defaultProvider, h('span', { class: 'hint' }, 'Tasks use this provider and its default model unless you choose an override below.')),
        h('div', { class: 'eyebrow' }, 'Connections'),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Configure a provider'), provider),
        h('div', { class: 'field' }, h('label', { for: 'set-base' }, 'Server URL'), baseUrl),
        keyField,
        cloudNotice,
        h('div', { class: 'field' }, h('label', { for: 'set-model' }, 'Provider’s default model'),
          filter, h('div', { class: 'row' }, h('div', { class: 'grow' }, modelSel), h('button', { class: 'btn', onclick: test }, icon('refresh', 'sm'), 'Test'))),
        status,
        h('div', { class: 'field' }, h('label', { for: 'set-llmctx' }, 'Custom instructions'), llmContext,
          h('span', { class: 'hint' }, 'Added to every question, recap and chapter analysis, for all novels. Each novel can also have its own notes under Contents → Novel settings.')),
        h('div', { class: 'row', style: { gap: '16px' } },
          h('div', { class: 'field grow' }, h('span', { class: 'label' }, 'Creativity'), h('div', { class: 'range-row', style: { gridTemplateColumns: '1fr 40px' } }, temp, tempOut)),
          h('div', { class: 'field', style: { width: '160px' } }, h('label', { for: 'set-ctx' }, 'Context window'), ctx)),
      ),
      h('div', { class: 'divider' }),
      h('div', { class: 'stack' }, h('span', { class: 'eyebrow' }, 'Models by task'),
        h('p', { class: 'hint' }, 'Mix providers freely—for example, local chapter analysis with OpenRouter answers. Configure each connection above, then load its models here. OpenRouter tasks send text to the cloud and may use credits.'), taskRows),
      h('div', { class: 'divider' }),
      h('div', { class: 'stack' }, h('div', { class: 'eyebrow' }, 'Analysis speed'),
        sw(adaptive, 'Automatically fit local analysis memory', 'Ollama uses the smallest estimated context window that fits the full chapter and output, up to your selected limit. This can reduce memory use and waiting.'),
        h('div', { class: 'field' }, h('label', { for: 'set-analysis-limit' }, 'Analysis output limit'), analysisLimit,
          h('span', { class: 'hint' }, 'Concise summaries and character notes. Increase if a chapter has many characters and its response reaches the limit.')),
        h('div', { class: 'hint' }, 'To catch up quickly, use Download context. Questions and recaps use chapter text directly; full character analysis is optional.')),
      h('div', { class: 'divider' }),
      h('div', { class: 'stack' },
        h('div', { class: 'eyebrow' }, 'Reading'),
        sw(autoAnalyze, 'Analyse chapters as I read', 'Uses your selected AI provider. Rapid page turns keep only the newest waiting chapter; optional bulk analysis fills earlier character history. OpenRouter usage may cost credits.'),
        sw(prefetch, 'Prefetch the next chapter', 'Loads the following chapter quietly so page turns are instant.'),
        h('div', { class: 'row', style: { justifyContent: 'space-between' } },
          h('div', { style: { display: 'grid', gap: '2px' } }, h('span', { style: { fontWeight: 500 } }, 'Delay between downloads'), h('span', { class: 'hint' }, 'Be polite to source sites during bulk imports (milliseconds).')),
          delay),
      ),
    ),
    footer: (close) => [h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => save(close) }, 'Save settings')],
  });
  test();
}

export function bookmarkletHref() {
  const origin = location.origin;
  const code = `(function(){var f=document.createElement('form');f.method='POST';f.action='${origin}/capture';f.target='_blank';f.acceptCharset='utf-8';f.style.display='none';[['url',location.href],['html',document.documentElement.outerHTML]].forEach(function(p){var t=document.createElement('textarea');t.name=p[0];t.value=p[1];f.appendChild(t)});document.body.appendChild(f);f.submit();setTimeout(function(){f.remove()},1000)})()`;
  return `javascript:${encodeURIComponent(code)}`;
}

export function openCaptureGuide() {
  const link = h('a', { class: 'bookmarklet', href: bookmarkletHref(), onclick: (e) => { e.preventDefault(); toast('Drag this button to your bookmarks bar.'); } }, icon('feather', 'sm'), 'Send to Marginalia');
  modal({
    title: 'Capture from your browser',
    description: 'Some sites block automated access. The capture button sends the chapter you are viewing, exactly as your browser shows it, straight into your library.',
    body: h('div', { class: 'stack lg' },
      h('div', { style: { display: 'grid', placeItems: 'center', padding: '18px', borderRadius: '14px', background: 'var(--bg-elev)', border: '1px solid var(--line)' } }, link),
      h('ol', { class: 'steps' },
        h('li', null, 'Show your bookmarks bar (', h('span', { class: 'kbd' }, 'Ctrl'), ' + ', h('span', { class: 'kbd' }, 'Shift'), ' + ', h('span', { class: 'kbd' }, 'B'), ').'),
        h('li', null, 'Drag the button above onto the bar.'),
        h('li', null, 'Open any chapter on the novel site, then click the bookmark. The chapter opens here, matched to its novel automatically.'),
      ),
      h('div', { class: 'callout' }, icon('shield', 'sm'), h('span', null, 'The bookmark only posts the current page to your own Marginalia server at ', h('b', null, location.origin), '. Nothing goes anywhere else.')),
    ),
    footer: (close) => [h('button', { class: 'btn primary', onclick: close }, 'Done')],
  });
}
