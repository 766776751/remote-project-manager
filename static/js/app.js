// 全局状态
let amapKey = '';
let amapSecurity = '';
let amapLoaded = false;
let amapMap = null;
let amapAutoComplete = null;
let amapGeocoder = null;
let customers = [];
let projects = [];
let selectedCustomerId = null;

const API_BASE = '';

// 只读展示模式：当页面加载了烘焙数据（window.__APP_DATA__）且不在本机（localhost）时进入。
// 此时直接读取快照、不调用后端接口、隐藏所有写入操作。
const STATIC_MODE = !!window.__APP_DATA__ &&
    !['localhost', '127.0.0.1', ''].includes(location.hostname);

// ---------- 工具函数 ----------

function $(id) { return document.getElementById(id); }

function escapeHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showToast(msg, type='info') {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show';
    if (type === 'error') t.style.background = 'var(--danger)';
    else if (type === 'success') t.style.background = 'var(--success)';
    else t.style.background = 'var(--primary)';
    setTimeout(() => t.classList.remove('show'), 2500);
}

async function api(url, options={}) {
    const res = await fetch(API_BASE + url, {
        headers: { 'Content-Type': 'application/json' },
        ...options
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `请求失败 ${res.status}`);
    }
    return res.json();
}

function formatDate(s) {
    if (!s) return '-';
    return s.replace('T', ' ').slice(0, 16);
}

function actionText(action) {
    const map = {
        'create': '创建项目',
        'update_code': '更新远程码',
        'status_change': '状态变更',
        'feedback_available': '反馈可用',
        'feedback_unavailable': '反馈不可用'
    };
    return map[action] || action;
}

function statusBadge(status) {
    if (status === 'available') return '<span class="badge badge-success">可用</span>';
    if (status === 'unavailable') return '<span class="badge badge-danger">不可用</span>';
    return '<span class="badge badge-danger">不可用</span>';
}

// ---------- 路由（合并为单页，无需切换） ----------

function showPage(page) {
    // 合并页：两个入口都指向同一页，统一加载两侧数据
    if (page === 'manage') {
        selectedCustomerId = null;
        const cs = $('customer-search'); if (cs) cs.value = '';
        const ps = $('project-search'); if (ps) ps.value = '';
    }
    loadHomeData();
    loadManageData();
}

async function loadHomeData() {
    if (STATIC_MODE) {
        const d = window.__APP_DATA__;
        customers = d.customers || [];
        projects = d.projects || [];
        populateCustomerFilters();
        renderHomeCards();
        return;
    }
    try {
        const [c, p] = await Promise.all([
            api('/api/customers'),
            api('/api/projects')
        ]);
        customers = c;
        projects = p;
        populateCustomerFilters();
        renderHomeCards();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function loadManageData() {
    if (STATIC_MODE) {
        const d = window.__APP_DATA__;
        customers = d.customers || [];
        projects = d.projects || [];
        populateCustomerSelect();
        renderCustomerList();
        renderProjectTable();
        return;
    }
    try {
        const [c, p] = await Promise.all([
            api('/api/customers'),
            api('/api/projects')
        ]);
        customers = c;
        projects = p;
        populateCustomerSelect();
        renderCustomerList();
        renderProjectTable();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

function populateCustomerFilters() {
    const selects = ['home-filter-customer', 'project-customer'];
    selects.forEach(id => {
        const el = $(id);
        if (!el) return;
        const val = el.value;
        el.innerHTML = '<option value="">全部客户</option>' +
            customers.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        el.value = val;
    });
}

function populateCustomerSelect() {
    const el = $('project-customer');
    el.innerHTML = '<option value="">请选择客户</option>' +
        customers.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}

// ---------- 首页：远程卡片墙 ----------

function renderHomeCards() {
    const customerId = $('home-filter-customer')?.value || '';
    const status = $('home-filter-status')?.value || '';

    let remote = projects.filter(p => p.supports_remote);
    if (customerId) remote = remote.filter(p => p.customer_id == customerId);
    if (status) remote = remote.filter(p => p.remote_status === status);

    const box = $('remote-cards');
    if (!remote.length) {
        box.innerHTML = '<div class="empty-state">暂无支持远程的项目</div>';
        return;
    }

    box.innerHTML = remote.map(p => {
        const cust = customers.find(c => c.id === p.customer_id);
        const rcs = p.rcs_url
            ? `<button class="rc-copy rc-copy-url" onclick="copyText('${p.rcs_url.replace(/'/g, "\\'")}')">🌐 ${p.rcs_url}</button>`
            : '';
        const upActive = p.remote_status === 'available' ? ' active' : '';
        const downActive = p.remote_status === 'unavailable' ? ' active' : '';
        const feedbackHtml = STATIC_MODE
            ? statusBadge(p.remote_status)
            : `<div class="rc-feedback">
                   <button class="rc-thumb rc-thumb-up${upActive}" onclick="feedbackProject(${p.id}, 'like')" title="标记可用"><svg width="14" height="14" viewBox="0 0 24 24"><path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></svg></button>
                   <button class="rc-thumb rc-thumb-down${downActive}" onclick="feedbackProject(${p.id}, 'dislike')" title="标记不可用"><svg width="14" height="14" viewBox="0 0 24 24"><path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 12h4V3h-4v12z"/></svg></button>
               </div>
               ${statusBadge(p.remote_status)}`;
        return `
        <div class="remote-card">
            <div class="rc-head">
                <span class="rc-customer">${cust?.name || '未知客户'}</span>
                <div class="rc-status-col">
                    ${feedbackHtml}
                </div>
            </div>
            <div class="rc-project">${p.name} <span class="rc-code">${p.code || ''}</span></div>
            <div class="rc-line"><span class="rc-label">软件</span><span class="rc-val">${p.remote_software || '-'}</span></div>
            <div class="rc-line highlight">
                <span class="rc-label">ID</span>
                <span class="rc-val mono">${p.remote_id || '-'}</span>
                <button class="rc-copy" onclick="copyText('${(p.remote_id || '').replace(/'/g, "\\'")}')">复制</button>
            </div>
            <div class="rc-line highlight pw">
                <span class="rc-label">密码</span>
                <span class="rc-val mono">${p.remote_password || '-'}</span>
                <button class="rc-copy" onclick="copyText('${(p.remote_password || '').replace(/'/g, "\\'")}')">复制</button>
            </div>
            ${rcs ? `<div class="rc-line rc-link-line">${rcs}</div>` : ''}
            ${p.note ? `<div class="rc-line"><span class="rc-label">备注</span><span class="rc-val note">${p.note}</span></div>` : ''}
            <div class="rc-foot">
                ${STATIC_MODE ? '' : `<button class="btn btn-sm" onclick="editProject(${p.id})">编辑</button>`}
                <button class="btn btn-sm btn-primary" onclick="copyCardInfo(${p.id})">复制全部信息</button>
            </div>
        </div>`;
    }).join('');
}

function copyCardInfo(id) {
    const p = projects.find(x => x.id === id);
    if (!p) return;
    const cust = customers.find(c => c.id === p.customer_id);
    const lines = [
        `客户：${cust ? cust.name : '未知客户'}`,
        `项目：${p.name}${p.code ? '（编号：' + p.code + '）' : ''}`,
        `软件：${p.remote_software || '-'}`,
        `ID：${p.remote_id || '-'}`,
        `密码：${p.remote_password || '-'}`,
        p.rcs_url ? `RCS地址：${p.rcs_url}` : '',
        p.note ? `备注：${p.note}` : ''
    ].filter(Boolean);
    copyText(lines.join('\n'));
}

function copyText(text) {
    if (!text) { showToast('无可复制内容', 'error'); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
            .then(() => showToast('已复制', 'success'))
            .catch(() => fallbackCopy(text));
    } else {
        fallbackCopy(text);
    }
}

function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); showToast('已复制', 'success'); }
    catch (e) { showToast('复制失败', 'error'); }
    document.body.removeChild(ta);
}

// ---------- 管理页：客户列表 ----------

function renderCustomerList(filter = '') {
    const list = $('customer-list');
    let filtered = customers;
    if (filter) {
        const kw = filter.toLowerCase();
        filtered = customers.filter(c =>
            c.name.toLowerCase().includes(kw) ||
            (c.province || '').toLowerCase().includes(kw) ||
            (c.city || '').toLowerCase().includes(kw)
        );
    }

    if (!filtered.length) {
        list.innerHTML = '<div class="empty-state">暂无客户</div>';
        return;
    }

    list.innerHTML = filtered.map(c => {
        const projCount = projects.filter(p => p.customer_id === c.id).length;
        const region = [c.province, c.city, c.district].filter(Boolean).join(' ');
        const active = (c.id === selectedCustomerId) ? ' active' : '';
        const maintainBtn = (active && !STATIC_MODE) ? `
            <button class="btn-edit-customer" title="地址调整" onclick="event.stopPropagation(); openCustomerModal(${c.id})">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                <span>地址调整</span>
            </button>` : '';
        return `
        <div class="customer-item${active}" onclick="filterByCustomer(${c.id})">
            ${maintainBtn}
            <div class="customer-name"><span class="cust-label">客户名称：</span>${c.name}</div>
            ${region ? `<div class="customer-meta" style="color:${getRegionColor(region)}"><span class="cust-label">所属地区：</span>${region}</div>` : ''}
            ${c.address ? `<div class="customer-addr" data-addr="${escapeHtml(c.address)}" title="双击复制地址" ondblclick="copyText(this.dataset.addr)"><span class="cust-label">详细地址：</span>${escapeHtml(c.address)}</div>` : ''}
            <div class="customer-count">${projCount} 个项目</div>
        </div>`;
    }).join('');
}

// 以常州为中心着色：越近越安全，越远越告警
function getRegionColor(region) {
    if (!region) return '#5B9BD5';
    if (region.includes('常州')) return '#7C9FD6';                                  // 常州市（最近）→ 淡靛蓝
    if (region.includes('江苏省') || region.includes('江苏')) return '#E8743B';     // 江苏省内其他（中）→ 黄红色
    return '#DC2626';                                                               // 外省（最远）→ 告警红
}

function showAllProjects() {
    selectedCustomerId = null;
    renderCustomerList($('customer-search').value);
    renderProjectTable($('project-search').value);
}

function exportBackup() {
    showToast('正在导出备份...');
    window.location = '/api/backup/export';
}

function importBackup(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (!confirm('导入备份将覆盖当前所有客户、项目和历史数据，确定继续？\n（建议先点「导出」备份当前数据）')) {
        input.value = '';
        return;
    }
    const fd = new FormData();
    fd.append('file', file);
    fetch('/api/backup/import', { method: 'POST', body: fd })
        .then(r => r.json().then(d => ({ ok: r.ok, d })))
        .then(({ ok, d }) => {
            if (!ok || d.error) {
                showToast('导入失败：' + (d.error || '未知错误'), 'error');
            } else {
                showToast('导入成功：客户 ' + d.imported.customers + ' / 项目 ' + d.imported.projects + ' / 历史 ' + d.imported.remote_history, 'success');
                loadManageData();
                loadHomeData();
            }
        })
        .catch(e => showToast('导入出错：' + e.message, 'error'))
        .finally(() => { input.value = ''; });
}

function filterCustomers() {
    renderCustomerList($('customer-search').value);
}

function filterByCustomer(customerId) {
    selectedCustomerId = (selectedCustomerId === customerId) ? null : customerId;
    renderCustomerList($('customer-search').value);
    renderProjectTable($('project-search').value);
}

// ---------- 管理页：项目表格 ----------

function renderProjectTable(filter = '') {
    const tbody = $('projects-tbody');
    let filtered = projects;

    // 按选中的客户过滤（默认 selectedCustomerId 为空时显示全部）
    if (selectedCustomerId) {
        filtered = filtered.filter(p => p.customer_id == selectedCustomerId);
    }

    // 按搜索词过滤
    if (filter) {
        const kw = filter.toLowerCase();
        filtered = filtered.filter(p =>
            p.name.toLowerCase().includes(kw) ||
            (p.code || '').toLowerCase().includes(kw) ||
            (p.remote_software || '').toLowerCase().includes(kw) ||
            (p.remote_id || '').toLowerCase().includes(kw)
        );
    }

    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px;">暂无项目</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(p => {
        const cust = customers.find(c => c.id === p.customer_id);
        const remoteCell = p.supports_remote
            ? `<span class="mono" title="密码: ${p.remote_password || '-'}">${p.remote_id || '-'}</span>`
            : '<span class="muted">-</span>';
        return `
        <tr>
            <td>
                <div class="proj-name">${p.name}</div>
                ${cust ? `<div class="proj-code">${cust.name}</div>` : ''}
            </td>
            <td class="mono">${p.code || '-'}</td>
            <td>${p.remote_software || '-'}</td>
            <td class="remote-cell">${remoteCell}${p.remote_password ? `<br><span class="mono pw">${p.remote_password}</span>` : ''}</td>
            <td>${statusBadge(p.remote_status)}</td>
            <td class="actions">
                ${STATIC_MODE ? '' : `<button class="btn btn-sm" onclick="editProject(${p.id})">编辑</button>`}
                ${STATIC_MODE || !p.supports_remote ? '' : `
                    <button class="btn btn-sm btn-success" onclick="feedbackProject(${p.id}, 'like')" title="可用">✓</button>
                    <button class="btn btn-sm btn-danger" onclick="feedbackProject(${p.id}, 'dislike')" title="不可用">✗</button>
                `}
            </td>
        </tr>`;
    }).join('');
}

// ---------- 客户弹窗 ----------

function openCustomerModal(id) {
    if (STATIC_MODE) return;
    if (id) {
        const c = customers.find(x => x.id === id);
        if (!c) return;
        $('customer-id').value = c.id;
        $('customer-name').value = c.name;
        $('customer-province').value = c.province || '';
        $('customer-city').value = c.city || '';
        $('customer-district').value = c.district || '';
        $('customer-address').value = c.address || '';
        $('customer-lng').value = c.lng || '';
        $('customer-lat').value = c.lat || '';
        $('customer-modal-title').textContent = '编辑客户';
    } else {
        $('customer-id').value = '';
        $('customer-form').reset();
        $('customer-modal-title').textContent = '新增客户';
    }
    $('customer-modal').classList.add('active');
    initAmapEditor();
}

function closeCustomerModal() {
    $('customer-modal').classList.remove('active');
}

async function saveCustomer(e) {
    e.preventDefault();
    const id = $('customer-id').value;
    const payload = {
        name: $('customer-name').value.trim(),
        province: $('customer-province').value.trim(),
        city: $('customer-city').value.trim(),
        district: $('customer-district').value.trim(),
        address: $('customer-address').value.trim(),
        lng: $('customer-lng').value,
        lat: $('customer-lat').value
    };
    try {
        if (id) {
            await api(`/api/customers/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
            showToast('客户已更新', 'success');
        } else {
            await api('/api/customers', { method: 'POST', body: JSON.stringify(payload) });
            showToast('客户已创建', 'success');
        }
        closeCustomerModal();
        loadManageData();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

// ---------- 项目弹窗 ----------

function openProjectModal() {
    if (STATIC_MODE) return;
    $('project-id').value = '';
    $('project-form').reset();
    $('project-supports-remote').value = '0';
    toggleRemoteFields();
    $('project-modal-title').textContent = '新增项目';
    $('project-history-section').style.display = 'none';
    $('project-modal').classList.add('active');
}

function closeProjectModal() {
    $('project-modal').classList.remove('active');
}

async function editProject(id) {
    const p = projects.find(x => x.id === id);
    if (!p) return;
    $('project-id').value = p.id;
    $('project-customer').value = p.customer_id;
    $('project-name').value = p.name;
    $('project-code').value = p.code || '';
    $('project-supports-remote').value = p.supports_remote ? '1' : '0';
    const sw = $('project-remote-software');
    if (p.remote_software && ![...sw.options].some(o => o.value === p.remote_software)) {
        const opt = document.createElement('option');
        opt.value = p.remote_software; opt.textContent = p.remote_software;
        sw.appendChild(opt);
    }
    sw.value = p.remote_software || '';
    $('project-remote-id').value = p.remote_id || '';
    $('project-remote-password').value = p.remote_password || '';
    $('project-rcs-url').value = p.rcs_url || '';
    $('project-note').value = p.note || '';
    $('project-remote-status').value = p.remote_status || 'unavailable';
    $('project-modal-title').textContent = '编辑项目';
    toggleRemoteFields();
    $('project-modal').classList.add('active');
    await loadProjectHistory(id);
    $('project-history-section').style.display = 'block';
}

function toggleRemoteFields() {
    const supported = $('project-supports-remote').value === '1';
    const fields = ['project-remote-software', 'project-remote-id', 'project-remote-password', 'project-rcs-url', 'project-remote-status'];
    fields.forEach(id => {
        const el = $(id);
        if (el) el.disabled = !supported;
    });
    if (!supported) {
        $('project-remote-software').value = '';
        $('project-remote-id').value = '';
        $('project-remote-password').value = '';
        $('project-rcs-url').value = '';
        $('project-remote-status').value = 'unavailable';
    }
}

async function saveProject(e) {
    e.preventDefault();
    const id = $('project-id').value;
    const payload = {
        customer_id: parseInt($('project-customer').value),
        name: $('project-name').value.trim(),
        code: $('project-code').value.trim(),
        supports_remote: $('project-supports-remote').value === '1',
        remote_software: $('project-remote-software').value.trim(),
        remote_id: $('project-remote-id').value.trim(),
        remote_password: $('project-remote-password').value,
        rcs_url: $('project-rcs-url').value.trim(),
        remote_status: $('project-remote-status').value,
        note: $('project-note').value.trim()
    };
    try {
        if (id) {
            await api(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
            showToast('已更新', 'success');
        } else {
            await api('/api/projects', { method: 'POST', body: JSON.stringify(payload) });
            showToast('已创建', 'success');
        }
        closeProjectModal();
        await loadManageData();
        await loadHomeData();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function feedbackProject(id, type) {
    try {
        await api(`/api/projects/${id}/feedback`, {
            method: 'POST',
            body: JSON.stringify({ type })
        });
        showToast(type === 'like' ? '已标记可用' : '已标记不可用', 'success');
        await loadManageData();
        renderHomeCards();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function loadProjectHistory(id) {
    if (STATIC_MODE) {
        const el = $('project-history-list');
        const rows = (window.__APP_DATA__.histories && window.__APP_DATA__.histories[id]) || [];
        if (!rows.length) {
            el.innerHTML = '<div style="color:var(--muted);font-size:12px;">暂无历史记录</div>';
            return;
        }
        el.innerHTML = rows.slice(0, 10).map(h => `
            <div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;">
                <span style="color:var(--muted);">${formatDate(h.created_at)}</span>
                <span style="margin-left:8px;">${actionText(h.action)}</span>
                ${h.note ? `<span style="margin-left:8px;color:var(--text-secondary);">${h.note}</span>` : ''}
            </div>
        `).join('');
        return;
    }
    try {
        const rows = await api(`/api/projects/${id}/history`);
        const el = $('project-history-list');
        if (!rows.length) {
            el.innerHTML = '<div style="color:var(--muted);font-size:12px;">暂无历史记录</div>';
            return;
        }
        el.innerHTML = rows.slice(0, 10).map(h => `
            <div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;">
                <span style="color:var(--muted);">${formatDate(h.created_at)}</span>
                <span style="margin-left:8px;">${actionText(h.action)}</span>
                ${h.note ? `<span style="margin-left:8px;color:var(--text-secondary);">${h.note}</span>` : ''}
            </div>
        `).join('');
    } catch (e) {
        showToast(e.message, 'error');
    }
}

// ---------- 高德地图 ----------

function loadAmap() {
    if (!amapKey) return;
    window._AMapSecurityConfig = { securityJsCode: amapSecurity || '' };
    const script = document.createElement('script');
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${amapKey}&plugin=AMap.AutoComplete,AMap.Geocoder`;
    script.onerror = () => {
        showToast('高德地图加载失败，已切换为手动地址', 'error');
    };
    script.onload = () => {
        amapLoaded = true;
    };
    document.head.appendChild(script);
}

function initAmapEditor() {
    if (!amapLoaded || typeof AMap === 'undefined') {
        $('address-search-group').style.display = 'none';
        return;
    }
    $('address-search-group').style.display = 'block';

    if (!amapMap) {
        amapMap = new AMap.Map('amap-container', {
            zoom: 11,
            center: [116.397428, 39.90923]
        });
    }

    if (!amapAutoComplete) {
        AMap.plugin(['AMap.AutoComplete', 'AMap.Geocoder'], () => {
            amapAutoComplete = new AMap.AutoComplete({ input: 'address-search' });
            amapGeocoder = new AMap.Geocoder({});
            amapAutoComplete.on('select', (e) => {
                if (e.poi && e.poi.location) {
                    setAddressFromPoi(e.poi);
                }
            });
        });
    }
}

function setAddressFromPoi(poi) {
    const loc = poi && poi.location;
    if (!loc) return;
    $('customer-lng').value = loc.lng;
    $('customer-lat').value = loc.lat;

    if (amapMap) {
        amapMap.setCenter([loc.lng, loc.lat]);
        amapMap.clearMap();
        new AMap.Marker({ position: [loc.lng, loc.lat], map: amapMap });
    }

    if (amapGeocoder) {
        amapGeocoder.getAddress([loc.lng, loc.lat], (status, result) => {
            if (status === 'complete' && result.regeocode) {
                const ac = result.regeocode.addressComponent;
                $('customer-province').value = ac.province || '';
                $('customer-city').value = ac.city || '';
                $('customer-district').value = ac.district || '';
                $('customer-address').value = result.regeocode.formattedAddress || (poi.name || '');
            } else {
                $('customer-address').value = poi.name || poi.address || '';
            }
        });
    } else {
        $('customer-address').value = poi.name || poi.address || '';
    }
}

// ---------- 初始化 ----------

async function init() {
    if (STATIC_MODE) {
        document.body.classList.add('readonly');
        const d = window.__APP_DATA__;
        customers = d.customers || [];
        projects = d.projects || [];
        showPage('home');
        showToast('当前为只读展示模式（数据快照，无法修改）', 'info');
        return;
    }
    try {
        const cfg = await api('/api/config');
        amapKey = cfg.amap_key || '';
        amapSecurity = cfg.amap_security_js_code || '';
        if (amapKey) loadAmap();
    } catch (e) {
        console.warn('配置加载失败', e);
    }
    showPage('home');
}

init();
