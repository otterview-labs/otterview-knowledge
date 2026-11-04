(() => {
    function node(tag, text, className) {
        const element = document.createElement(tag);
        if (text) element.textContent = text;
        if (className) element.className = className;
        return element;
    }

    function button(label, action, className) {
        const element = node('button', label, className);
        element.type = 'button';
        element.addEventListener('click', action);
        return element;
    }

    const bodyStatus = {
        completed: '可检索', processed: '可检索', failed: '入库失败',
        pending: '等待入库', processing: '正在入库',
    };
    const waiting = status => status === 'pending' || status === 'running';
    const resultId = item => item.debug?.internal?.content_id || item.doc_id || item.content_id || item.source_doc || item.id;
    const snippet = item => item.snippet || item.content || item.text || item.chunk || '';

    // Find a verbatim source range, ignoring whitespace introduced by extraction.
    function excerptFinder(body) {
        let compact, positions;
        return excerpt => {
            if (typeof excerpt !== 'string' || !(excerpt = excerpt.trim())) return null;
            const exact = body.indexOf(excerpt);
            if (exact >= 0) return [exact, exact + excerpt.length];
            if (compact === undefined) {
                positions = new Uint32Array(body.length);
                let offset = 0;
                compact = body.replace(/\s+|\S+/g, (run, index) => {
                    if (/^\s/.test(run)) return '';
                    for (let i = 0; i < run.length; i++) positions[offset++] = index + i;
                    return run;
                });
            }
            const wanted = excerpt.replace(/\s/g, '');
            const position = compact.indexOf(wanted);
            return position < 0 ? null : [positions[position], positions[position + wanted.length - 1] + 1];
        };
    }

    class KnowledgeDocumentReader {
        constructor(root, request, resolveUrl) {
            this.root = root;
            this.request = request;
            this.resolveUrl = resolveUrl;
            this.results = root.querySelector('[data-reader-results]');
            this.workspace = root.querySelector('[data-reader-workspace]');
            this.reader = root.querySelector('[data-reader-detail]');
            this.status = root.querySelector('[data-reader-status]');
            this.title = root.querySelector('[data-reader-title]');
            root.querySelector('[data-reader-close]').onclick = () => this.close(true);
        }

        reset() {
            clearTimeout(this.timer);
            this.selection?.abort();
            this.selection = null;
            this.detail = null;
            this.body = '';
            this.findExcerpt = null;
            this.graph = null;
        }

        close(returnFocus = false) {
            this.reset();
            this.root.hidden = true;
            this.reader.replaceChildren();
            this.results.replaceChildren();
            if (returnFocus) this.opener?.focus();
        }

        show(opener, scroll = true) {
            this.opener = opener;
            this.root.hidden = false;
            if (scroll) this.root.scrollIntoView({block: 'nearest'});
        }

        message(text) {
            this.workspace.hidden = true;
            this.status.hidden = false;
            this.status.textContent = text;
        }

        showResults(items, query) {
            this.reset();
            this.title.textContent = '搜索结果';
            if (!items.length) {
                this.message('没有匹配的结果，请试试其他关键词或检索方式。');
                return;
            }
            this.workspace.hidden = false;
            this.status.hidden = true;
            this.results.hidden = false;
            const heading = node('h3', '匹配条目');
            heading.append(node('span', String(items.length), 'kr-count'));
            const list = node('div', '', 'kr-result-list');
            const rows = items.map(item => {
                const entry = button('', () => choose(item, entry), 'kr-result');
                entry.append(
                    node('strong', item.title || item.name || '未命名结果'),
                    node('span', snippet(item) || '暂无匹配片段', 'kr-snippet'),
                );
                entry.setAttribute('aria-pressed', 'false');
                list.append(entry);
                return entry;
            });
            const choose = (item, entry) => {
                rows.forEach(row => row.setAttribute('aria-pressed', String(row === entry)));
                this.select(item, resultId(item), query);
            };
            this.results.replaceChildren(heading, list);
            choose(items[0], rows[0]);
        }

        openDocument(doc, opener) {
            this.title.textContent = '文档详情';
            this.show(opener);
            this.workspace.hidden = false;
            this.status.hidden = true;
            this.results.hidden = true;
            this.select(doc, doc.id, '');
            this.root.querySelector('[data-reader-close]').focus({preventScroll: true});
        }

        async get(path, options = {}) {
            const response = await this.request('/api/v1/rag/documents' + path, {
                ...options, signal: this.selection.signal, cache: 'no-store', quiet: true,
            });
            if (!response?.result || response.success === false || response.status >= 400) {
                throw new Error('文档数据不可用');
            }
            return response.result;
        }

        async select(item, id, query) {
            this.reset();
            this.currentTab = 'body';
            this.excerpt = snippet(item);
            this.query = query;
            this.reader.replaceChildren(node('p', '正在加载正文…', 'kr-message'));
            if (!id) {
                this.reader.replaceChildren(node('p', this.excerpt || '该结果没有可打开的原文。', 'kr-message'));
                return;
            }
            const selection = this.selection = new AbortController();
            try {
                const detail = await this.get('/get', {method: 'POST', body: JSON.stringify({document_id: id})});
                if (selection.signal.aborted) return;
                if (!detail.id) throw new Error('文档不存在');
                this.detail = detail;
                this.body = detail.raw_content || detail.content?.text || '';
                this.findExcerpt = excerptFinder(this.body);
                this.mountDetail();
                this.scheduleRefresh();
            } catch (error) {
                if (selection.signal.aborted) return;
                this.reader.replaceChildren(node('p', '无法加载此文档的原文。', 'kr-message'),
                    button('重试', () => this.select(item, id, query), 'kr-link kr-retry'));
            }
        }

        mountDetail() {
            const doc = this.detail;
            const heading = node('div', '', 'kr-doc-heading');
            heading.append(node('h3', doc.title || doc.file_info?.name || '未命名文档'));
            this.meta = node('div', '', 'kr-meta');
            heading.append(this.meta);
            this.renderMeta();
            const bar = node('div', '', 'kr-tabs');
            bar.setAttribute('role', 'tablist');
            bar.setAttribute('aria-label', '文档内容');
            this.content = node('div', '', 'kr-content');
            this.content.id = 'kr-document-content';
            this.content.setAttribute('role', 'tabpanel');
            this.content.tabIndex = 0;
            const tabs = [['body', '正文'], ['summary', 'AI 摘要'], ['relations', '关联知识']];
            this.tabButtons = tabs.map(([key, title], index) => {
                const tab = button(title, () => this.activate(key), 'kr-tab');
                tab.id = 'kr-tab-' + key;
                tab.setAttribute('role', 'tab');
                tab.setAttribute('aria-controls', this.content.id);
                tab.addEventListener('keydown', event => {
                    const targets = {ArrowLeft: (index + 2) % 3, ArrowRight: (index + 1) % 3, Home: 0, End: 2};
                    if (!(event.key in targets)) return;
                    event.preventDefault();
                    const next = targets[event.key];
                    this.activate(tabs[next][0]);
                    this.tabButtons[next].focus();
                });
                bar.append(tab);
                return tab;
            });
            this.reader.replaceChildren(heading, bar, this.content);
            this.activate('body');
        }

        renderMeta() {
            const doc = this.detail;
            const status = doc.enrichment?.processing_status || doc.processing_status;
            const filename = doc.file_info?.name;
            const date = doc.create_time?.slice(0, 10);
            this.meta.replaceChildren(
                node('span', [filename !== doc.title && filename, date].filter(Boolean).join(' · ')),
                node('span', bodyStatus[status] || '', status === 'completed' || status === 'processed' ? 'kr-ready' : ''),
            );
        }

        activate(tab, evidence = null) {
            this.currentTab = tab;
            this.tabButtons.forEach(element => {
                const active = element.id === 'kr-tab-' + tab;
                element.setAttribute('aria-selected', String(active));
                element.tabIndex = active ? 0 : -1;
            });
            this.content.setAttribute('aria-labelledby', 'kr-tab-' + tab);
            this.content.scrollTop = 0;
            if (tab === 'body') this.renderBody(evidence);
            if (tab === 'summary') this.renderSummary();
            if (tab === 'relations') this.renderRelations();
        }

        renderBody(evidence) {
            const doc = this.detail;
            const text = this.body;
            const range = evidence || this.findExcerpt(this.excerpt) || this.findExcerpt(this.query);
            const pre = node('div', '', 'kr-body-text');
            if (range) {
                const mark = node('mark', text.slice(...range));
                pre.append(text.slice(0, range[0]), mark, text.slice(range[1]));
                requestAnimationFrame(() => {
                    if (!mark.isConnected) return;
                    const top = mark.getBoundingClientRect().top - this.content.getBoundingClientRect().top;
                    if (top > this.content.clientHeight - 48) this.content.scrollTop = top - 24;
                });
            } else {
                pre.textContent = text || '暂无可展示的正文。';
            }
            const kind = doc.content_scope === 'recognized_text' ? '识别文字' : '正文';
            this.content.replaceChildren(node('h4', kind), pre);
            const file = doc.content?.url || doc.file_info?.url;
            const mediaUrl = file && this.resolveUrl(file);
            if (mediaUrl && !file.startsWith('/api/v1/rag/documents/raw/')) {
                const url = new URL(mediaUrl, window.location.href);
                if (url.protocol === 'http:' || url.protocol === 'https:') {
                    const link = node('a', '查看原文件', 'kr-link kr-file-link');
                    link.href = url.href;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    this.content.prepend(link);
                    if (doc.content?.type === 'image' || doc.content?.type === 'video') {
                        const image = doc.content.type === 'image';
                        const media = node(image ? 'img' : 'video', '', 'kr-media');
                        if (image) {
                            media.alt = doc.title || '原图';
                            media.loading = 'lazy';
                        } else {
                            media.controls = true;
                            media.preload = 'metadata';
                        }
                        media.addEventListener('error', () => media.remove());
                        media.src = url.href;
                        this.content.insertBefore(media, this.content.querySelector('h4'));
                    }
                }
            }
        }

        renderSummary() {
            const data = this.detail.enrichment?.summary || {text: this.detail.summary, tags: this.detail.tags};
            const full = data.scope === 'full_document';
            const label = full ? '全文摘要' : 'AI 摘要';
            const finished = data.status === 'completed';
            const state = {
                running: label + ' · 后台生成中',
                pending: label + ' · 等待后台处理',
                failed: label + ' · 生成失败',
            };
            this.content.replaceChildren();
            if (!finished) {
                const status = node('div', '', 'kr-stage');
                status.setAttribute('role', 'status');
                status.append(node('strong', state[data.status] || '暂无 AI 摘要'));
                if (this.detail.enrichment?.processing_status === 'completed') {
                    status.append(node('span', '正文已可检索，可先查看原文。'));
                }
                this.content.append(status);
            }
            const summary = data.generated_text || data.text;
            if (summary) {
                const title = finished ? (data.manually_edited && !data.generated_text ? '人工摘要' : label)
                    : data.manually_edited ? '人工摘要' : '基础摘要';
                this.content.append(node('h4', title), node('p', summary, 'kr-body-text'));
                if (data.manually_edited && data.generated_text && data.text) {
                    this.content.append(node('h4', '人工摘要'), node('p', data.text, 'kr-body-text'));
                }
            }
            if (data.key_points?.length) {
                const points = node('ul', '', 'kr-points');
                data.key_points.forEach(point => points.append(node('li', point)));
                this.content.append(node('h4', '关键点'), points);
            }
            if (data.tags?.length) {
                const tags = node('div', '', 'kr-tags');
                data.tags.forEach(tag => tags.append(node('span', tag)));
                this.content.append(node('h4', '内容标签'), tags);
            }
        }

        async renderRelations() {
            const graph = this.detail.enrichment?.knowledge_graph;
            const stage = {
                pending: '关联知识等待后台处理。',
                running: '正在提取关联知识。',
                failed: '关联知识生成失败，仍可查看正文。',
                skipped: '此文档未生成关联知识。',
            };
            this.content.replaceChildren(node('h4', '文档中的关系'));
            if (stage[graph?.status]) {
                this.content.append(node('p', stage[graph.status], 'kr-meta'));
                return;
            }
            if (!this.graph) {
                this.content.append(node('p', '正在加载关联知识…', 'kr-meta'));
                const selection = this.selection;
                try {
                    const response = await this.get('/' + encodeURIComponent(this.detail.id) + '/relations');
                    if (selection.signal.aborted) return;
                    this.graph = response;
                    if (this.currentTab === 'relations') this.renderRelations();
                } catch (error) {
                    if (selection.signal.aborted || this.currentTab !== 'relations') return;
                    this.content.replaceChildren(node('p', '无法加载关联知识。', 'kr-meta'),
                        button('重试', () => this.renderRelations(), 'kr-link'));
                }
                return;
            }
            const relations = this.graph.relations || [];
            if (!relations.length) {
                this.content.append(node('p', stage[this.graph.status] || '暂无源自此文档的知识关系。', 'kr-meta'));
                return;
            }
            for (const relation of relations) {
                const item = node('div', '', 'kr-relation');
                item.append(node('strong', [relation.source, relation.type || '相关', relation.target].join(' · ')));
                const range = this.findExcerpt(relation.evidence);
                if (range) {
                    item.append(node('p', this.body.slice(...range), 'kr-meta'),
                        button('定位正文', () => {
                            this.activate('body', range);
                            this.tabButtons[0].focus({preventScroll: true});
                        }, 'kr-link'));
                }
                this.content.append(item);
            }
        }

        scheduleRefresh() {
            const current = this.detail.enrichment;
            if (!waiting(current?.summary?.status) && !waiting(current?.knowledge_graph?.status)) return;
            const selection = this.selection;
            this.timer = setTimeout(async () => {
                if (selection.signal.aborted) return;
                try {
                    const data = await this.get('/' + encodeURIComponent(this.detail.id) + '/enrichment');
                    if (selection.signal.aborted) return;
                    this.detail.enrichment = data;
                    this.renderMeta();
                    if (this.currentTab === 'summary' && JSON.stringify(current.summary) !== JSON.stringify(data.summary)) {
                        this.renderSummary();
                    }
                    if (current.knowledge_graph?.status !== data.knowledge_graph?.status) {
                        this.graph = null;
                        if (this.currentTab === 'relations') this.renderRelations();
                    }
                } catch (error) {
                    if (selection.signal.aborted) return;
                }
                this.scheduleRefresh();
            }, 4000);
        }
    }

    window.KnowledgeDocumentReader = KnowledgeDocumentReader;
})();
