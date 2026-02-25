/* ════════════════════════════════════════════════════
   Prompt Template Editor — Single-file Application
   ════════════════════════════════════════════════════ */

const LOCKED_IDS = ['persona', 'world_info_before_char', 'character_card', 'world_info_after_char', 'chat_history'];
const CONTENT_MAX_LENGTH = 4000;

let appData = null; // holds the full JSON object

// ── DOM refs ──
const importFileEl = document.getElementById('importFile');
const exportBtn = document.getElementById('exportBtn');
const addCardBtn = document.getElementById('addCardBtn');
const editorContent = document.getElementById('editorContent');
const emptyState = document.getElementById('emptyState');
const toastContainer = document.getElementById('toastContainer');
const checkPromptBtn = document.getElementById(`checkPrompt`); // 目前未實作

// ── Toast ──
function showToast(message, type = 'info') {
    const icons = {
        success: '✓',
        error: '✕',
        info: 'ℹ'
    };
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `<span>${icons[type] || ''}</span> ${escapeHtml(message)}`;
    toastContainer.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

// ── Import ──
importFileEl.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const data = JSON.parse(ev.target.result);
            if (!data.prompt_cards || !data.metadata) {
                throw new Error('JSON 缺少 prompt_cards 或 metadata 欄位');
            }
            appData = data;
            renderAll();
            exportBtn.disabled = false;
            addCardBtn.disabled = false;
            checkPromptBtn.disabled = false; // 目前未實作
            showToast('範本匯入成功', 'success');
        } catch (err) {
            showToast('匯入失敗：' + err.message, 'error');
        }
    };
    reader.readAsText(file);
    e.target.value = '';
});

// ── Export ──
exportBtn.addEventListener('click', () => {
    if (!appData) return;
    // update updated_at for all cards
    // (already updated on each field change)
    const blob = new Blob([JSON.stringify(appData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const name = appData.metadata.name || 'prompt_template';
    a.download = name.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_') + '.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('已匯出 JSON 檔案', 'success');
});

// ── Add Card ──
addCardBtn.addEventListener('click', () => {
    if (!appData) return;
    const now = new Date().toISOString();
    const newCard = {
        id: 'new_card_' + Date.now(),
        library_id: appData.prompt_cards.length > 0 ? appData.prompt_cards[0].library_id : '',
        name: '新卡片',
        content: '',
        role: 'system',
        placement: 'sequence',
        history_depth: null,
        order_index: getNextOrderIndex(),
        enabled: true,
        is_system: false,
        trigger_keywords: [],
        trigger_probability: 1.0,
        created_at: now,
        updated_at: now
    };
    appData.prompt_cards.push(newCard);
    renderAll();
    // Expand the new card
    const cards = document.querySelectorAll('.prompt-card');
    const last = cards[cards.length - 1];
    if (last) {
        last.classList.add('expanded');
        last.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    showToast('已新增卡片', 'success');
});

// ── 這裡都是AI產的 Prompt Check ──
checkPromptBtn.addEventListener('click', () => {
    if (!appData) return;
    const preview = document.getElementById('prompt-preview');
    const counter = document.getElementById('prompt-preview-count');
    if (!preview) return;
    const combined = buildCombinedPrompt();
    preview.value = combined;
    if (counter) counter.textContent = `${combined.length} / ${CONTENT_MAX_LENGTH} chars`;
    showToast('已產生合併提示詞', 'success');
});

function buildCombinedPrompt() {
    const sorted = appData.prompt_cards
        .filter(card => card.enabled)
        .slice()
        .sort((a, b) => a.order_index - b.order_index);
    //用來處理order的
    //vvv
    let Prompt_order = 0;
    //上一個role，用來合併同role用的
    //vvv
    let Last_prompt_role = "";
    // 对每张卡片进行处理，过滤掉内容为空的卡片
    const processed = sorted
        .map((card) => {
            // 对卡片内容进行 renderCertainText 处理
            const processedContent = renderCertainText(card.content || '').trim();
            // 返回卡片和处理后的内容
            return { card, processedContent };
        })
        .filter(({ processedContent }) => processedContent.length > 0)  // 只保留有内容的卡片
        .map(({ card, processedContent }) => {
            //合併同role
            //初始的role是空的(不然開頭會合併到空role內)
            //vvv
            if(Last_prompt_role == ""){
                Last_prompt_role = card.role;
                return `[${++Prompt_order}] ${card.role.toUpperCase()}:\n${processedContent}`;
            }
            else if(card.role != Last_prompt_role){
                Last_prompt_role = card.role;
                return `[${++Prompt_order}] ${card.role.toUpperCase()}:\n${processedContent}`;
            }
            else{
                return `${processedContent}`;
            }
        })
        .filter(Boolean)
        .join('\n\n');
    
    return processed;
}

//用來記renderCertainText函式處理的變數用的，沒這個會全空值(除非在同一張卡片)
//vvv
var Variables={};

// ── render certain text ──
// 处理 {{setvar::变量名::值}}、{{getvar::变量名}}、{{random:选项1,选项2,...}}、{{roll:XdY}} 的替换
function renderCertainText(text) {
    if (!text) return text;
    
    // 第一步：提取所有 setvar 定义，创建变量映射表
    const setvarPattern = /\{\{setvar::([^:]+)::([\s\S]*?)\}\}/g;
    let match;
    
    while ((match = setvarPattern.exec(text)) !== null) {
        const varName = match[1].trim();
        const varValue = match[2] || '';
        Variables[varName] = varValue;
    }
    
    // 第二步：替换所有 getvar 引用为对应的值
    const getvarPattern = /\{\{getvar::([^}]+?)\}\}/g;
    let result = text.replace(getvarPattern, (fullMatch, varName) => {
        const trimmedName = varName.trim();
        return Variables.hasOwnProperty(trimmedName) ? Variables[trimmedName] : fullMatch;
    });
    
    // 處理{{random::1::2::...}}的模板語法
    const randomPattern1 = /\{\{random::([^}]+)\}\}/g;
    result = result.replace(randomPattern1, (fullMatch, optionsStr) => {
        const options = optionsStr.split('::').map(opt => opt.trim()).filter(opt => opt);
        if (options.length === 0) return fullMatch;
        const randomIndex = Math.floor(Math.random() * options.length);
        return options[randomIndex];
    });

    // 第三步：处理 {{random:选项1,选项2,...}} 随机选择
    const randomPattern2 = /\{\{random:([^}]+)\}\}/g;
    result = result.replace(randomPattern2, (fullMatch, optionsStr) => {
        const options = optionsStr.split(',').map(opt => opt.trim()).filter(opt => opt);
        if (options.length === 0) return fullMatch;
        const randomIndex = Math.floor(Math.random() * options.length);
        return options[randomIndex];
    });
    
    // 第四步：处理 {{roll:XdY}} 掷骰子
    const rollPattern = /\{\{roll:(\d+)d(\d+)\}\}/g;
    result = result.replace(rollPattern, (fullMatch, diceCount, diceSize) => {
        const count = parseInt(diceCount, 10);
        const size = parseInt(diceSize, 10);
        
        if (count <= 0 || size <= 0) return fullMatch;
        
        let total = 0;
        for (let i = 0; i < count; i++) {
            total += Math.floor(Math.random() * size) + 1;
        }
        return total.toString();
    });
    
    // 第五步：移除所有 setvar 定义语句（因为它们已经被处理）
    result = result.replace(setvarPattern, '');

    // 第六步：將{{跟}}替換成{和}
    result = result.replace(/\{\{/g,'{');
    result = result.replace(/\}\}/g,'}');
    
    // 清理多余空行
    result = result.replace(/\n\n\n+/g, '\n\n');
    
    return result;
}

// ── 這裡都是AI產的 Prompt Check End ──
function getNextOrderIndex() {
    if (!appData || appData.prompt_cards.length === 0) return 0;
    return Math.min(9999, Math.max(...appData.prompt_cards.map(c => c.order_index)) + 1);
}

// ── Render All ──
function renderAll() {
    editorContent.innerHTML = '';
    if (!appData) {
        editorContent.appendChild(emptyState);
        return;
    }
    renderMetadata();
    renderPromptCards();
}

// ── Render Metadata ──
function renderMetadata() {
    const section = document.createElement('section');
    section.className = 'section';
    section.innerHTML = `
    <div class="section-header">
      <h2>📋 Metadata</h2>
      <span class="badge">基本資訊</span>
    </div>
    <div class="metadata-card">
      <div class="field-group">
        <div class="field">
          <label for="meta-name">Name</label>
          <input type="text" id="meta-name" value="${escapeAttr(appData.metadata.name || '')}" placeholder="範本名稱">
        </div>
        <div class="field">
          <label for="meta-temp">Temperature</label>
          <input type="number" id="meta-temp" value="${appData.metadata.temperature ?? 1.0}" min="0" max="2" step="0.01" placeholder="0.00 ~ 2.00">
        </div>
      </div>
      <div class="field-group full">
        <div class="field">
          <label for="meta-desc">Description</label>
          <input type="text" id="meta-desc" value="${escapeAttr(appData.metadata.description || '')}" placeholder="範本說明">
        </div>
      </div>
    </div>
    <div class="metadata-card prompt-check-card">
      <div class="field-group full">
        <div class="field">
          <label for="prompt-preview">Prompt Preview</label>
          <textarea id="prompt-preview" rows="6" readonly placeholder="點擊『檢查提示詞』產生合併內容"></textarea>
          <div class="char-count" id="prompt-preview-count">0 / ${CONTENT_MAX_LENGTH} chars</div>
        </div>
      </div>
    </div>
  `;

    //prompt check button and textarea, expecting to make all card content together and check prompt.





    editorContent.appendChild(section);

    // Bind events
    const nameInput = section.querySelector('#meta-name');
    const descInput = section.querySelector('#meta-desc');
    const tempInput = section.querySelector('#meta-temp');

    nameInput.addEventListener('input', () => { appData.metadata.name = nameInput.value; });
    descInput.addEventListener('input', () => { appData.metadata.description = descInput.value; });
    tempInput.addEventListener('change', () => {
        let v = parseFloat(tempInput.value);
        if (isNaN(v) || v < 0) v = 0;
        if (v > 2) v = 2;
        v = Math.round(v * 100) / 100;
        tempInput.value = v;
        appData.metadata.temperature = v;
    });
}

// ── Render Prompt Cards ──
function renderPromptCards() {
    const section = document.createElement('section');
    section.className = 'section';
    section.innerHTML = `
    <div class="section-header">
      <h2>🃏 Prompt Cards</h2>
      <span class="badge">${appData.prompt_cards.length} 張卡片</span>
    </div>
  `;

    const list = document.createElement('div');
    list.className = 'card-list';
    list.id = 'cardList';

    // Sort by order_index for display
    const sortedIndices = appData.prompt_cards
        .map((c, i) => ({ card: c, idx: i }))
        .sort((a, b) => a.card.order_index - b.card.order_index);

    sortedIndices.forEach(({ card, idx }) => {
        list.appendChild(createCardElement(card, idx));
    });

    section.appendChild(list);

    // Add card button
    const addBtn = document.createElement('button');
    addBtn.className = 'add-card-btn';
    addBtn.id = 'addCardBtnInline';
    addBtn.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    新增 Prompt 卡片
  `;
    addBtn.addEventListener('click', () => addCardBtn.click());
    section.appendChild(addBtn);

    editorContent.appendChild(section);
}

// ── Create Card Element ──
function createCardElement(card, dataIndex) {
    const isLocked = LOCKED_IDS.includes(card.id);
    const el = document.createElement('div');
    el.className = `prompt-card${isLocked ? ' locked' : ''}`;
    el.dataset.index = dataIndex;

    // Header
    const header = document.createElement('div');
    header.className = 'card-header';
    header.innerHTML = `
    <div class="card-toggle">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </div>
    <div class="card-title">
      <span class="card-id">${escapeHtml(card.id)}</span>
      <span class="card-name">${escapeHtml(card.name)}</span>
    </div>
    <div class="card-badges">
      ${isLocked ? '<span class="card-badge locked">🔒 鎖定</span>' : ''}
      ${card.is_system ? '<span class="card-badge system">SYSTEM</span>' : ''}
    </div>
    <div class="order-index-inline" title="Order Index">
      #<input type="number" min="0" max="9999" step="1" value="${card.order_index}" class="order-input" data-idx="${dataIndex}" aria-label="Order Index">
    </div>
  `;

    // Toggle expand
    header.addEventListener('click', (e) => {
        if (e.target.closest('.order-index-inline') || e.target.closest('.card-enabled-toggle')) return;
        el.classList.toggle('expanded');
    });

    // Enabled toggle button
    const toggle = document.createElement('button');
    toggle.className = `card-enabled-toggle ${card.enabled ? 'on' : 'off'}`;
    toggle.title = card.enabled ? '已啟用' : '已停用';
    toggle.setAttribute('aria-label', 'Toggle enabled');
    if (isLocked) toggle.disabled = true;
    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isLocked) return;
        card.enabled = !card.enabled;
        card.updated_at = new Date().toISOString();
        toggle.className = `card-enabled-toggle ${card.enabled ? 'on' : 'off'}`;
        toggle.title = card.enabled ? '已啟用' : '已停用';
    });
    header.appendChild(toggle);

    el.appendChild(header);

    // Order index input event
    const orderInput = header.querySelector('.order-input');
    orderInput.addEventListener('click', (e) => e.stopPropagation());
    orderInput.addEventListener('change', () => {
        let v = parseInt(orderInput.value, 10);
        if (isNaN(v) || v < 0) v = 0;
        if (v > 9999) v = 9999;
        orderInput.value = v;
        card.order_index = v;
        card.updated_at = new Date().toISOString();
    });

    // Body
    const body = document.createElement('div');
    body.className = 'card-body';
    body.innerHTML = buildCardBody(card, dataIndex, isLocked);
    el.appendChild(body);

    // Bind body events after append
    setTimeout(() => bindCardBodyEvents(el, card, dataIndex, isLocked), 0);

    return el;
}

function buildCardBody(card, idx, isLocked) {
    const contentLen = (card.content || '').length;
    const isHistoryPlacement = card.placement === 'history';

    return `
    <div class="field-group">
      <div class="field">
        <label>ID</label>
        <input type="text" value="${escapeAttr(card.id)}" ${isLocked ? 'disabled' : ''} data-field="id" data-idx="${idx}" placeholder="英文字串，空格自動轉底線">
      </div>
      <div class="field">
        <label>Name</label>
        <input type="text" value="${escapeAttr(card.name)}" ${isLocked ? 'disabled' : ''} data-field="name" data-idx="${idx}" placeholder="卡片名稱">
      </div>
    </div>

    <div class="field-group full">
      <div class="field">
        <label>Content</label>
        <textarea rows="5" maxlength="4000" ${isLocked ? 'disabled' : ''} data-field="content" data-idx="${idx}" placeholder="輸入 Prompt 內容（上限 4000 字）">${escapeHtml(card.content || '')}</textarea>
        <div class="char-count ${contentLen > CONTENT_MAX_LENGTH ? 'over' : ''}" data-counter="${idx}">${contentLen} / ${CONTENT_MAX_LENGTH}</div>
      </div>
    </div>

    <div class="field-group triple">
      <div class="field">
        <label>Role</label>
        <select ${isLocked ? 'disabled' : ''} data-field="role" data-idx="${idx}">
          <option value="system" ${card.role === 'system' ? 'selected' : ''}>system</option>
          <option value="user" ${card.role === 'user' ? 'selected' : ''}>user</option>
          <option value="assistant" ${card.role === 'assistant' ? 'selected' : ''}>assistant</option>
        </select>
      </div>
      <div class="field">
        <label>Placement</label>
        <select ${isLocked ? 'disabled' : ''} data-field="placement" data-idx="${idx}">
          <option value="sequence" ${card.placement === 'sequence' ? 'selected' : ''}>sequence</option>
          <option value="history" ${card.placement === 'history' ? 'selected' : ''}>history</option>
          <option value="summary" ${card.placement === 'summary' ? 'selected' : ''}>summary</option>
        </select>
      </div>
      <div class="field">
        <label>History Depth</label>
        <input type="number" min="0" max="999" step="1"
          value="${card.history_depth !== null && card.history_depth !== undefined ? card.history_depth : ''}"
          ${(!isHistoryPlacement || isLocked) ? 'disabled' : ''}
          data-field="history_depth" data-idx="${idx}"
          placeholder="${isHistoryPlacement ? '0~999' : 'N/A'}">
      </div>
    </div>

    <div class="field-group">
      <div class="field">
        <label>Enabled</label>
        <select ${isLocked ? 'disabled' : ''} data-field="enabled" data-idx="${idx}">
          <option value="true" ${card.enabled ? 'selected' : ''}>true</option>
          <option value="false" ${!card.enabled ? 'selected' : ''}>false</option>
        </select>
      </div>
      <div class="field">
        <label>Order Index</label>
        <input type="number" min="0" max="9999" step="1" value="${card.order_index}" data-field="order_index" data-idx="${idx}">
      </div>
    </div>

    ${!isLocked ? `
    <div class="card-actions">
      <button class="card-action-btn" data-action="duplicate" data-idx="${idx}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        複製
      </button>
      <button class="card-action-btn delete" data-action="delete" data-idx="${idx}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        刪除
      </button>
    </div>` : ''}
  `;
}

function bindCardBodyEvents(el, card, idx, isLocked) {
    // Field inputs
    el.querySelectorAll('[data-field]').forEach(input => {
        const field = input.dataset.field;
        const eventType = input.tagName === 'TEXTAREA' ? 'input' : (input.tagName === 'SELECT' ? 'change' : 'input');

        input.addEventListener(eventType, () => {
            const c = appData.prompt_cards[idx];
            if (!c) return;

            switch (field) {
                case 'id':
                    if (!isLocked) {
                        c.id = input.value.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
                        input.value = c.id;
                        // Update header display
                        const idSpan = el.querySelector('.card-id');
                        if (idSpan) idSpan.textContent = c.id;
                    }
                    break;
                case 'name':
                    if (!isLocked) {
                        c.name = input.value;
                        const nameSpan = el.querySelector('.card-name');
                        if (nameSpan) nameSpan.textContent = c.name;
                    }
                    break;
                case 'content':
                    if (!isLocked) {
                        c.content = input.value;
                        const counter = el.querySelector(`[data-counter="${idx}"]`);
                        if (counter) {
                            const len = c.content.length;
                            counter.textContent = `${len} / ${CONTENT_MAX_LENGTH}`;
                            counter.className = `char-count ${len > CONTENT_MAX_LENGTH ? 'over' : ''}`;
                        }
                    }
                    break;
                case 'role':
                    if (!isLocked) c.role = input.value;
                    break;
                case 'placement':
                    if (!isLocked) {
                        c.placement = input.value;
                        const depthInput = el.querySelector('[data-field="history_depth"]');
                        if (depthInput) {
                            if (input.value === 'history') {
                                depthInput.disabled = false;
                                depthInput.placeholder = '0~999';
                            } else {
                                depthInput.disabled = true;
                                depthInput.value = '';
                                depthInput.placeholder = 'N/A';
                                c.history_depth = null;
                            }
                        }
                    }
                    break;
                case 'history_depth':
                    if (!isLocked && card.placement === 'history') {
                        let v = parseInt(input.value, 10);
                        if (isNaN(v) || v < 0) v = 0;
                        if (v > 999) v = 999;
                        c.history_depth = v;
                    }
                    break;
                case 'enabled':
                    if (!isLocked) {
                        c.enabled = input.value === 'true';
                        // Sync header toggle
                        const headerToggle = el.querySelector('.card-enabled-toggle');
                        if (headerToggle) {
                            headerToggle.className = `card-enabled-toggle ${c.enabled ? 'on' : 'off'}`;
                            headerToggle.title = c.enabled ? '已啟用' : '已停用';
                        }
                    }
                    break;
                case 'order_index': {
                    let v = parseInt(input.value, 10);
                    if (isNaN(v) || v < 0) v = 0;
                    if (v > 9999) v = 9999;
                    input.value = v;
                    c.order_index = v;
                    // Sync header order input
                    const headerOrder = el.querySelector('.order-input');
                    if (headerOrder && headerOrder !== input) headerOrder.value = v;
                    break;
                }
            }
            c.updated_at = new Date().toISOString();
        });
    });

    // Action buttons
    el.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            const i = parseInt(btn.dataset.idx, 10);
            if (action === 'delete') {
                showDeleteModal(i);
            } else if (action === 'duplicate') {
                duplicateCard(i);
            }
        });
    });
}

// ── Duplicate Card ──
function duplicateCard(idx) {
    const src = appData.prompt_cards[idx];
    if (!src) return;
    const now = new Date().toISOString();
    const dup = JSON.parse(JSON.stringify(src));
    dup.id = src.id + '_copy';
    dup.name = src.name + ' (副本)';
    dup.is_system = false;
    dup.created_at = now;
    dup.updated_at = now;
    dup.order_index = Math.min(9999, src.order_index + 1);
    appData.prompt_cards.splice(idx + 1, 0, dup);
    renderAll();
    showToast('已複製卡片', 'success');
}

// ── Delete Modal ──
function showDeleteModal(idx) {
    const card = appData.prompt_cards[idx];
    if (!card) return;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
    <div class="modal">
      <h3>確認刪除卡片</h3>
      <p style="color:var(--text-secondary);font-size:0.9rem;margin-bottom:8px;">
        您確定要刪除 <strong style="color:var(--text-primary)">${escapeHtml(card.name)}</strong>（<code style="font-family:var(--font-mono);font-size:0.82rem;color:var(--accent)">${escapeHtml(card.id)}</code>）嗎？
      </p>
      <p style="color:var(--text-muted);font-size:0.82rem;">此操作無法復原。</p>
      <div class="modal-actions">
        <button class="toolbar-btn" id="modalCancel">取消</button>
        <button class="toolbar-btn danger-outline" id="modalConfirm">刪除</button>
      </div>
    </div>
  `;
    document.body.appendChild(overlay);

    overlay.querySelector('#modalCancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#modalConfirm').addEventListener('click', () => {
        appData.prompt_cards.splice(idx, 1);
        overlay.remove();
        renderAll();
        showToast('已刪除卡片', 'info');
    });
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
}

// ── Escape attribute ──
function escapeAttr(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
