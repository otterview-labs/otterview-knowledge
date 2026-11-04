// 知识库管理
class KnowledgeBase {
    constructor() {
        this.categories = [];
        this.documents = [];
        this.filteredDocuments = [];
        this.currentCategory = null;
        this.searchQuery = '';
        this.currentFilters = {
            status: 'all',
            type: 'all'
        };
        this.documentCountsLoaded = false; // 添加标记防止重复加载
        this.searchMode = 'normal'; // 'normal' | 'intelligent' 搜索模式
        this.isLoadingDocuments = false; // 防止并发加载文档
        
        // 添加文档数量缓存
        this.categoryDocumentCounts = new Map(); // 缓存每个分类的文档数量
        
        // 分页相关
        this.pagination = {
            pageIndex: 0,
            pageSize: 12,
            total: 0,
            sorts: [
                { name: 'createTime', order: 'desc' }
            ],
            terms: []
        };
        this.paginationComponent = null;
        
        this.init();
    }

    // 初始化
    async init() {
        this.checkAuth();
        this.initEventListeners();
        this.initGlobalShortcuts();
        this.initTooltips();
        this.initVisibilityChange();
        this.initPagination();
        
        // 加载分类列表
        await this.loadCategories();
        
        // 渲染分类列表
        this.renderCategories();
        
        // 初始化默认分类
        await this.initializeDefaultCategory();
        
        this.addSelectionHelpers();
        
        // 监听文档选择变化
        document.addEventListener('change', (e) => {
            if (e.target.classList.contains('document-checkbox')) {
                this.updateSelectionUI();
            }
        });
        
        console.log('调试: 初始化完成，当前分类 =', this.currentCategory);
    }

    // 检查认证状态
    checkAuth() {
        if (!Utils.isLoggedIn()) {
            Utils.navigate('/static/login.html');
            return;
        }
    }

    // 初始化事件监听器
    initEventListeners() {
        // 分类搜索
        const categorySearch = document.querySelector('.knowledge-search input');
        if (categorySearch) {
            categorySearch.addEventListener('input', Utils.debounce((e) => {
                this.filterCategories(e.target.value);
            }, 300));
        }

        // 文档筛选
        const filterInputs = document.querySelectorAll('.filter-input, .filter-select');
        filterInputs.forEach(input => {
            if (input.placeholder && input.placeholder.includes('名称')) {
                // 文档名称搜索框使用智能搜索
                input.addEventListener('input', Utils.debounce((e) => {
                    this.smartSearch(e.target.value);
                }, 500));
            } else {
                // 其他筛选器使用普通筛选
                input.addEventListener('input', () => this.filterDocuments());
                input.addEventListener('change', () => this.filterDocuments());
            }
        });

        // 上传按钮
        const uploadBtn = document.getElementById('uploadBtn');
        if (uploadBtn) {
            uploadBtn.addEventListener('click', () => this.showUploadModal());
        }

        // 批量操作
        const batchBtn = document.getElementById('batchBtn');
        if (batchBtn) {
            batchBtn.addEventListener('click', () => this.toggleBatchActions());
        }

        // 新建分类按钮
        const newCategoryBtn = document.querySelector('.sidebar-actions .fa-plus')?.parentElement;
        if (newCategoryBtn) {
            newCategoryBtn.addEventListener('click', () => this.showCreateCategoryModal());
        }
        
        // 添加高级搜索功能
        this.initAdvancedSearch();
    }
    
    // 初始化高级搜索
    initAdvancedSearch() {
        // 添加搜索快捷键支持
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                const searchInput = document.querySelector('.filter-input[placeholder*="名称"]');
                if (searchInput) {
                    searchInput.focus();
                    searchInput.select();
                }
            }
        });
        
        // 添加搜索历史功能
        const searchInput = document.querySelector('.filter-input[placeholder*="名称"]');
        if (searchInput) {
            searchInput.addEventListener('focus', () => {
                this.showSearchSuggestions();
            });
            
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    this.saveSearchHistory(e.target.value);
                }
            });
        }
    }
    
    // 显示搜索建议
    showSearchSuggestions() {
        const searchHistory = JSON.parse(localStorage.getItem('knowledgeBaseSearchHistory') || '[]');
        if (searchHistory.length === 0) return;
        
        // 实现搜索建议下拉框（可选功能）
        console.log('搜索历史:', searchHistory);
    }
    
    // 保存搜索历史
    saveSearchHistory(query) {
        if (!query.trim()) return;
        
        let history = JSON.parse(localStorage.getItem('knowledgeBaseSearchHistory') || '[]');
        history = [query, ...history.filter(item => item !== query)].slice(0, 10);
        localStorage.setItem('knowledgeBaseSearchHistory', JSON.stringify(history));
    }

    // 初始化分页组件
    initPagination() {
        const paginationContainer = document.querySelector('#document-pagination');
        if (paginationContainer) {
            this.paginationComponent = new PaginationComponent(paginationContainer, {
                pageSize: this.pagination.pageSize,
                onPageChange: (pageIndex, pageSize) => {
                    this.pagination.pageIndex = pageIndex;
                    this.pagination.pageSize = pageSize;
                    this.loadDocuments();
                },
                onPageSizeChange: (pageIndex, pageSize) => {
                    this.pagination.pageIndex = pageIndex;
                    this.pagination.pageSize = pageSize;
                    this.loadDocuments();
                }
            });
        }
    }

    // 加载分类列表（修改为使用新的分页API）
    async loadCategories() {
        try {
            console.log('📂 开始加载RAG集合列表...');
            
            // 使用标准分页API
            const pageRequest = PaginationUtils.createPageRequest(0, 100); // 加载前100个分类
            const response = await PaginationUtils.fetchPage('/api/v1/rag/collections/list', pageRequest);
            
            console.log('📂 API响应:', response);
            
            if (response.status === 200 && response.result) {
                this.categories = response.result.data || [];
                console.log('✅ 分页API加载分类成功:', this.categories.length, '个集合');
                
                // 为每个集合设置默认值
                this.categories.forEach(category => {
                    if (!category.config) category.config = {};
                    if (!category.document_count) category.document_count = 0;
                    if (!category.status) category.status = 1;
                });
                
            } else {
                console.warn('⚠️ API返回格式异常:', response);
                this.categories = [];
            }
            
        } catch (error) {
            console.error('❌ 加载分类列表失败:', error);
            Utils.showToast('无法连接到服务器，请检查网络连接', 'error');
            this.categories = [];
            this.renderErrorState();
        }
    }

    // 渲染错误状态
    renderErrorState() {
        const categoryList = document.querySelector('.knowledge-list');
        if (!categoryList) return;
        
        categoryList.innerHTML = `
            <div class="error-state">
                <div class="error-content">
                    <i class="fas fa-exclamation-triangle"></i>
                    <h3>加载失败</h3>
                    <p>无法连接到服务器，请检查网络连接后重试</p>
                    <button class="btn btn-primary" onclick="knowledgeBase.refreshData()">
                        <i class="fas fa-refresh"></i>
                        重新加载
                    </button>
                </div>
            </div>
        `;
    }

    // 加载文档列表（支持分页）
    async loadDocuments() {
        console.log('📄 DEBUG: loadDocuments 函数被调用！');
        console.log('📄 DEBUG: 调用栈:', new Error().stack.split('\n').slice(1, 4).join('\n'));
        console.log('📄 DEBUG: this.isLoadingDocuments =', this.isLoadingDocuments);
        console.log('📄 DEBUG: this.currentCategory =', this.currentCategory);
        
        if (this.isLoadingDocuments) return;
        
        this.isLoadingDocuments = true;
        const documentSection = document.querySelector('#document-section');
        const loadingIndicator = document.querySelector('#document-loading');
        
        try {
            if (loadingIndicator) loadingIndicator.style.display = 'block';
            
            // 构建查询条件
            const terms = [];
            if (this.currentCategory) {
                terms.push(PaginationUtils.createTerm('collection_id', this.currentCategory, 'eq'));
            }
            if (this.searchQuery) {
                terms.push(PaginationUtils.createTerm('title', this.searchQuery, 'like'));
            }
            
            // 创建分页请求
            const pageRequest = PaginationUtils.createPageRequest(
                this.pagination.pageIndex,
                this.pagination.pageSize,
                this.pagination.sorts,
                terms
            );
            
            console.log('📄 DEBUG: 分页请求 =', pageRequest);
            
            // 尝试使用新的分页API
            let response;
            let useNewAPI = false;
            
            try {
                // 注意：由于我们只实现了collections的分页API，这里先使用它作为示例
                if (window.PaginationUtils) {
                    // 如果有分页工具，尝试使用新API（这里仅作演示，实际需要对应的文档分页端点）
                    console.log('📄 DEBUG: 尝试使用新分页API...');
                    // 暂时不使用新API，因为文档分页端点还没有创建
                    throw new Error('文档分页API暂未实现');
                }
            } catch (error) {
                console.log('📄 DEBUG: 新分页API失败，使用旧API:', error.message);
            }
            
            // 使用新的POST接口
            const url = this.currentCategory 
                ? '/api/v1/rag/collections/documents'
                : '/api/v1/rag/documents';
                
            const requestData = this.currentCategory 
                ? {
                    pageIndex: 0,
                    pageSize: 100,
                    sorts: [],
                    terms: [],
                    collection_id: this.currentCategory
                }
                : {
                    pageIndex: 0,
                    pageSize: 100,
                    sorts: [],
                    terms: []
                };
                
            console.log('📄 DEBUG: 构建的请求URL =', url);
            console.log('📄 DEBUG: 请求数据 =', requestData);
            console.log('📄 DEBUG: 当前分类ID =', this.currentCategory, '类型:', typeof this.currentCategory);
            
            console.log('📄 DEBUG: 即将发送HTTP请求...');
            response = await Utils.request(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestData)
            });
            console.log('📄 DEBUG: HTTP请求完成');
            console.log('📄 DEBUG: API响应状态 =', response?.status);
            console.log('📄 DEBUG: API响应消息 =', response?.message);
            console.log('📄 DEBUG: API完整响应 =', JSON.stringify(response, null, 2));
            
            // 检查响应是否有效
            if (!response || response.status !== 200) {
                throw new Error(`API响应无效: ${response?.message || '未知错误'}`);
            }
            
            // 处理不同的响应格式
            let documents = [];
            let total = 0;
            
            if (response.result && response.result.data) {
                // 标准分页格式 (新接口)
                documents = response.result.data || [];
                total = response.result.total || 0;
                console.log('📄 DEBUG: 使用标准分页格式，数据数量 =', documents.length, '总数 =', total);
            } else if (response.result && Array.isArray(response.result)) {
                // 兼容旧格式 (直接返回数组)
                documents = response.result || [];
                total = documents.length;
                console.log('📄 DEBUG: 使用兼容格式，数据数量 =', documents.length);
            } else if (response.data && Array.isArray(response.data)) {
                // 另一种格式
                documents = response.data || [];
                total = documents.length;
                console.log('📄 DEBUG: 使用data格式，数据数量 =', documents.length);
            } else if (response.success && response.data && Array.isArray(response.data)) {
                // success格式
                documents = response.data || [];
                total = documents.length;
                console.log('📄 DEBUG: 使用success格式，数据数量 =', documents.length);
            } else {
                console.warn('📄 DEBUG: 无法识别响应格式，使用空数组');
                documents = [];
                total = 0;
            }
            
            this.documents = documents;
            this.pagination.total = total;
            
            console.log('📄 DEBUG: API返回数据数量 =', this.documents.length);
            
            // 如果是从特定分类加载的文档，直接设置为filteredDocuments
            // 如果是加载所有文档，则需要应用筛选
            if (this.currentCategory) {
                this.filteredDocuments = [...this.documents];
            } else {
                this.filteredDocuments = [...this.documents];
                this.filterDocuments(); // 应用其他筛选条件
            }
            
            console.log('📄 DEBUG: 加载到文档数量 =', this.documents.length);
            console.log('📄 DEBUG: 过滤后文档数量 =', this.filteredDocuments.length);
            console.log('📄 DEBUG: 文档数据样本 =', this.documents.slice(0, 2));
            
            // 更新分页组件
            if (this.paginationComponent) {
                this.paginationComponent.update(
                    0, // 旧API没有真正的分页，始终显示第一页
                    this.filteredDocuments.length,
                    this.filteredDocuments.length // 页面大小设为总数以显示所有数据
                );
            }
            
        } catch (error) {
            console.error('📄 DEBUG: 加载文档失败:', error);
            console.log('📄 DEBUG: 使用空数组或模拟数据');
            console.log('📄 DEBUG: 错误详情 =', error.message);
            console.log('📄 DEBUG: 当前分类 =', this.currentCategory);
            console.log('📄 DEBUG: API URL =', url);
            console.log('📄 DEBUG: 请求数据 =', requestData);
            
            // 设置为空数组并显示错误状态
            this.documents = [];
            this.filteredDocuments = [];
            this.renderDocumentsErrorState();
            
            this.pagination.total = 0;
            
            if (this.paginationComponent) {
                this.paginationComponent.update(0, 0, this.pagination.pageSize);
            }
            
            // 显示错误提示
            Utils.showToast(`加载文档失败: ${error.message}`, 'error');
        } finally {
            this.isLoadingDocuments = false;
            if (loadingIndicator) loadingIndicator.style.display = 'none';
            console.log('📄 DEBUG: loadDocuments 函数执行完毕');
        }
    }

    // 渲染文档错误状态
    renderDocumentsErrorState() {
        const tableBody = document.querySelector('.file-table tbody');
        if (!tableBody) return;
        
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="error-state" style="text-align: center; padding: 40px;">
                    <div style="color: #EF4444;">
                        <i class="fas fa-exclamation-triangle" style="font-size: 48px; margin-bottom: 16px;"></i>
                        <h3>加载失败</h3>
                        <p>无法连接到服务器，请检查网络连接后重试</p>
                        <button class="btn btn-primary" onclick="knowledgeBase.loadDocuments()">
                            <i class="fas fa-refresh"></i>
                            重新加载
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }

    // 渲染分类列表
    renderCategories() {
        const categoryList = document.querySelector('.knowledge-list');
        if (!categoryList) return;

        console.log('调试: 渲染分类列表，分类数量 =', this.categories.length);
        console.log('调试: 分类数据 =', this.categories.map(c => ({id: c.id, name: c.name})));

        categoryList.innerHTML = this.categories.map(category => {
            // 显示已缓存的文档数量，如果没有则显示加载中
            let docCount = this.getCachedDocumentCount(category.id);
            if (docCount === null) {
                docCount = '--'; // 还没有加载过这个分类的数量
                // 异步加载这个分类的文档数量
                this.loadCategoryDocumentCount(category.id);
            }
            
            console.log('调试: 渲染分类 =', category.id, '名称 =', category.name, '文档数量 =', docCount);
            
            return `
            <div class="knowledge-category">
                <div class="category-header ${String(this.currentCategory) === String(category.id) ? 'active' : ''}" 
                     onclick="console.log('Category clicked:', '${category.id}'); window.knowledgeBase.selectCategory('${category.id}');">
                    <div class="category-info">
                        <h4>${category.name}</h4>
                        <p>${category.description || '暂无描述'}</p>
                        <div class="category-stats">
                            <span class="doc-count" id="doc-count-${category.id}">${docCount} 个文档</span>
                            <span class="status ${(category.is_public !== false && category.status === '1') ? 'active' : 'inactive'}">
                                ${(category.is_public !== false && category.status === '1') ? '启用' : '禁用'}
                            </span>
                        </div>
                    </div>
                    <div class="category-actions" onclick="event.stopPropagation()">
                        <div class="toggle-switch ${(category.is_public !== false && category.status === '1') ? 'active' : ''}" 
                             onclick="window.knowledgeBase.toggleCategory('${category.id}')" title="启用/禁用"></div>
                        <button class="icon-btn" onclick="window.knowledgeBase.showCategoryMenu('${category.id}', event)" title="更多操作">
                            <i class="fas fa-ellipsis-v"></i>
                        </button>
                    </div>
                </div>
            </div>`
        }).join('');
        
        // 加载其他分类的文档数量（当前分类的数量已经通过 renderCategories 显示）
        this.loadOtherDocumentCounts();
    }
    
    // 初始化默认分类并加载其文档
    async initializeDefaultCategory() {
        // 如果没有选中任何分类，默认选中第一个并立即加载其文档
        if (!this.currentCategory && this.categories.length > 0) {
            const firstCategoryId = String(this.categories[0].id);
            this.currentCategory = firstCategoryId;
            console.log('调试: 设置默认分类 =', this.currentCategory, '类型:', typeof this.currentCategory);
            
            // 立即加载默认分类的文档
            try {
                this.isLoadingDocuments = true;
                await this.loadDocuments();
                this.renderDocuments();
                // 重新渲染分类列表以更新active状态和文档数量
                this.renderCategoriesOnly();
                console.log('调试: 默认分类文档加载完成，数量 =', this.documents.length);
            } catch (error) {
                console.error('加载默认分类文档失败:', error);
            } finally {
                this.isLoadingDocuments = false;
            }
        }
    }

    // 只渲染分类列表，不执行初始化逻辑
    renderCategoriesOnly() {
        const categoryList = document.querySelector('.knowledge-list');
        if (!categoryList) return;

        categoryList.innerHTML = this.categories.map(category => {
            // 显示已缓存的文档数量，如果没有则显示加载中
            let docCount = this.getCachedDocumentCount(category.id);
            if (docCount === null) {
                docCount = '--'; // 还没有加载过这个分类的数量
                // 异步加载这个分类的文档数量
                this.loadCategoryDocumentCount(category.id);
            }
            
            return `
            <div class="knowledge-category">
                <div class="category-header ${String(this.currentCategory) === String(category.id) ? 'active' : ''}" 
                     onclick="console.log('Category clicked:', '${category.id}'); window.knowledgeBase.selectCategory('${category.id}');">
                    <div class="category-info">
                        <h4>${category.name}</h4>
                        <p>${category.description || '暂无描述'}</p>
                        <div class="category-stats">
                            <span class="doc-count" id="doc-count-${category.id}">${docCount} 个文档</span>
                            <span class="status ${(category.is_public !== false && category.status === '1') ? 'active' : 'inactive'}">
                                ${(category.is_public !== false && category.status === '1') ? '启用' : '禁用'}
                            </span>
                        </div>
                    </div>
                    <div class="category-actions" onclick="event.stopPropagation()">
                        <div class="toggle-switch ${(category.is_public !== false && category.status === '1') ? 'active' : ''}" 
                             onclick="window.knowledgeBase.toggleCategory('${category.id}')" title="启用/禁用"></div>
                        <button class="icon-btn" onclick="window.knowledgeBase.showCategoryMenu('${category.id}', event)" title="更多操作">
                            <i class="fas fa-ellipsis-v"></i>
                        </button>
                    </div>
                </div>
            </div>`
        }).join('');
    }
    
    // 加载其他分类（非当前分类）的文档数量
    async loadOtherDocumentCounts() {
        for (const category of this.categories) {
            // 跳过当前选中的分类，因为它的数量已经在 renderCategories 中显示了
            if (String(category.id) === String(this.currentCategory)) continue;
            
            try {
                const response = await Utils.request('/api/v1/rag/collections/documents', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        pageIndex: 0,
                        pageSize: 100,
                        sorts: [],
                        terms: [],
                        collection_id: category.id
                    })
                });
                
                // 处理标准分页响应格式
                const count = response.result?.data?.length || response.result?.total || 0;
                
                const countElement = document.getElementById(`doc-count-${category.id}`);
                if (countElement) {
                    countElement.textContent = `${count} 个文档`;
                }
            } catch (error) {
                console.error(`加载分类 ${category.id} 的文档数量失败:`, error);
                const countElement = document.getElementById(`doc-count-${category.id}`);
                if (countElement) {
                    countElement.textContent = '-- 个文档';
                }
            }
        }
    }
    
    // 加载每个分类的文档数量
    async loadDocumentCounts() {
        if (this.documentCountsLoaded) return; // 防止重复加载
        
        this.documentCountsLoaded = true;
        
        for (const category of this.categories) {
            try {
                const response = await Utils.request('/api/v1/rag/collections/documents', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        pageIndex: 0,
                        pageSize: 100,
                        sorts: [],
                        terms: [],
                        collection_id: category.id
                    })
                });
                
                // 处理标准分页响应格式  
                const count = response.result?.data?.length || response.result?.total || 0;
                
                const countElement = document.getElementById(`doc-count-${category.id}`);
                if (countElement) {
                    countElement.textContent = `${count} 个文档`;
                }
            } catch (error) {
                console.error(`加载分类 ${category.id} 的文档数量失败:`, error);
                const countElement = document.getElementById(`doc-count-${category.id}`);
                if (countElement) {
                    countElement.textContent = '-- 个文档';
                }
            }
        }
    }
    
    // 更新特定分类的文档数量
    async updateCategoryDocumentCount(categoryId) {
        try {
            const response = await Utils.request('/api/v1/rag/collections/documents', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    pageIndex: 0,
                    pageSize: 100,
                    sorts: [],
                    terms: [],
                    collection_id: categoryId
                })
            });
            
            // 处理标准分页响应格式
            const count = response.result?.data?.length || response.result?.total || 0;
            
            const countElement = document.getElementById(`doc-count-${categoryId}`);
            if (countElement) {
                countElement.textContent = `${count} 个文档`;
            }
        } catch (error) {
            console.error(`更新分类 ${categoryId} 的文档数量失败:`, error);
        }
    }
    
    // 获取指定分类的文档数量
    getDocumentCountForCategory(categoryId) {
        return this.documents.filter(doc => 
            doc.category === categoryId || 
            doc.collection_id === categoryId ||
            doc.vector_collection === categoryId
        ).length;
    }
    
    // 获取缓存的文档数量
    getCachedDocumentCount(categoryId) {
        // 如果是当前选中的分类且已加载文档，返回当前文档数量
        if (String(categoryId) === String(this.currentCategory) && this.documents) {
            return this.documents.length;
        }
        
        // 否则返回缓存的数量，如果没有缓存则返回null
        return this.categoryDocumentCounts.get(categoryId) || null;
    }
    
    // 异步加载分类的文档数量
    async loadCategoryDocumentCount(categoryId) {
        // 避免重复加载
        if (this.categoryDocumentCounts.has(categoryId)) {
            return;
        }
        
        try {
            const response = await Utils.request('/api/v1/rag/collections/documents', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pageIndex: 0,
                    pageSize: 1, // 只需要获取数量，不需要实际数据
                    sorts: [],
                    terms: [],
                    collection_id: categoryId
                })
            });
            
            const count = response.result?.total || response.result?.data?.length || 0;
            this.categoryDocumentCounts.set(categoryId, count);
            
            // 更新UI中该分类的显示
            const countElement = document.getElementById(`doc-count-${categoryId}`);
            if (countElement) {
                countElement.textContent = `${count} 个文档`;
            }
            
        } catch (error) {
            console.warn(`加载分类 ${categoryId} 的文档数量失败:`, error);
            // 设置错误状态，避免重复尝试
            this.categoryDocumentCounts.set(categoryId, 0);
        }
    }

    // 渲染文档列表
    renderDocuments() {
        console.log('调试: 开始渲染文档，数量 =', this.filteredDocuments.length);
        console.log('调试: 原始文档数量 =', this.documents.length);
        console.log('调试: 当前分类 =', this.currentCategory);
        
        const tableBody = document.querySelector('.file-table tbody');
        if (!tableBody) {
            console.log('调试: 未找到表格 tbody 元素');
            return;
        }

        if (this.filteredDocuments.length === 0) {
            console.log('调试: 没有文档，显示空状态');
            // 不要破坏表格结构，只清空tbody并显示空状态行
            tableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="empty-state" style="text-align: center; padding: 40px;">
                        <div style="color: #9CA3AF;">
                            <i class="fas fa-file-alt" style="font-size: 48px; margin-bottom: 16px; opacity: 0.3;"></i>
                            <p style="margin: 0; font-size: 16px;">暂无文档</p>
                            <p style="margin: 8px 0 0 0; font-size: 14px; opacity: 0.7;">请先上传一些文档</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }
        
        tableBody.innerHTML = this.filteredDocuments.map(doc => `
            <tr>
                <td>
                    <input type="checkbox" class="document-checkbox" value="${doc.id}">
                </td>
                <td>
                    <div class="file-info">
                        <div class="file-icon ${doc.type}">
                            <i class="${this.getFileIcon(doc.type)}"></i>
                        </div>
                        <div class="file-details">
                            <div class="file-name" onclick="window.knowledgeBase.viewDocument('${doc.id}')" title="点击查看详情">
                                ${doc.name || doc.title}
                                ${doc.isSemanticResult ? '<span class="semantic-badge" title="语义搜索结果">🔍</span>' : ''}
                            </div>
                            <div class="file-meta">
                                ${this.formatFileSize(doc.file_size)} · ${this.formatDate(doc.created_at)}
                                ${doc.similarity_score ? ` · 相似度: ${(doc.similarity_score * 100).toFixed(0)}%` : ''}
                            </div>
                            ${doc.snippet ? `<div class="file-snippet">${doc.snippet}</div>` : ''}
                            ${doc.summary ? `<div class="file-summary" title="${doc.summary}">摘要: ${this.truncateText(doc.summary, 80)}</div>` : ''}
                            ${doc.tags && doc.tags.length > 0 ? `<div class="file-tags">${doc.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}</div>` : ''}
                        </div>
                    </div>
                </td>
                <td>${doc.category || doc.vector_collection || '未分类'}</td>
                <td title="${doc.description || ''}">${this.truncateText(doc.description || '--', 50)}</td>
                <td>${doc.upload_type || '本地上传'}</td>
                <td>
                    <span class="status ${doc.status}">${this.getStatusText(doc.status)}</span>
                </td>
                <td>
                    <div class="action-btns">
                        <button class="btn-icon" onclick="window.knowledgeBase.viewDocument('${doc.id}')" title="查看">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="btn-icon" onclick="window.knowledgeBase.editDocument('${doc.id}')" title="编辑">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-icon" onclick="window.knowledgeBase.analyzeContent('${doc.id}')" title="智能分析">
                            <i class="fas fa-robot"></i>
                        </button>
                        <button class="btn-icon" onclick="window.knowledgeBase.downloadDocument('${doc.id}')" title="下载">
                            <i class="fas fa-download"></i>
                        </button>
                        <button class="btn-icon" onclick="window.knowledgeBase.showDocumentMenu('${doc.id}', event)" title="更多">
                            <i class="fas fa-ellipsis-v"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
        
        console.log('调试: 文档渲染完成');
    }

    // 渲染空状态
    renderEmptyState() {
        return `
            <div class="empty-knowledge">
                <div class="empty-knowledge-icon">
                    <i class="fas fa-database"></i>
                </div>
                <h3>暂无文档</h3>
                <p>开始上传您的第一个文档到知识库吧</p>
                <button class="btn btn-primary" onclick="window.knowledgeBase.showUploadModal()">
                    <i class="fas fa-upload"></i> 上传文档
                </button>
            </div>
        `;
    }

    // 获取文件图标
    getFileIcon(type) {
        const iconMap = {
            document: 'fas fa-file-alt',
            image: 'fas fa-file-image',
            video: 'fas fa-file-video',
            audio: 'fas fa-file-audio'
        };
        return iconMap[type] || 'fas fa-file';
    }

    // 获取状态文本
    getStatusText(status) {
        const statusMap = {
            processed: '已处理',
            processing: '处理中',
            failed: '处理失败'
        };
        return statusMap[status] || status;
    }

    // 选择分类
    async selectCategory(categoryId) {
        console.log('🎯 DEBUG: selectCategory 函数被调用！');
        console.log('🎯 DEBUG: categoryId 参数 =', categoryId, '类型:', typeof categoryId);
        console.log('🎯 DEBUG: 调用栈:', new Error().stack.split('\n').slice(1, 4).join('\n'));
        
        // 确保categoryId不是字符串类型的 "undefined" 或 null
        if (!categoryId || categoryId === 'undefined' || categoryId === 'null') {
            console.error('🎯 DEBUG: 无效的categoryId =', categoryId);
            return;
        }
        
        // 防止重复点击同一分类（使用字符串比较）
        if (String(this.currentCategory) === String(categoryId)) {
            console.log('🎯 DEBUG: 重复选择同一分类，跳过');
            return;
        }
        
        // 防止并发调用
        if (this.isLoadingDocuments) {
            console.log('🎯 DEBUG: 正在加载文档，跳过重复请求');
            return;
        }
        
        console.log('🎯 DEBUG: 选择分类 =', categoryId, '类型:', typeof categoryId);
        console.log('🎯 DEBUG: 之前的分类 =', this.currentCategory);
        console.log('🎯 DEBUG: 完整分类数据 =', this.categories.find(c => c.id === categoryId));
        
        this.isLoadingDocuments = true;
        const oldCategory = this.currentCategory;
        
        try {
            this.currentCategory = String(categoryId);  // 确保为字符串类型
            console.log('🎯 DEBUG: 设置新的currentCategory =', this.currentCategory);
            
            // 重新加载该分类的文档
            console.log('🎯 DEBUG: 即将调用 loadDocuments()');
            await this.loadDocuments();
            console.log('🎯 DEBUG: loadDocuments() 调用完成');
            
            // 更新当前分类的文档数量缓存
            if (this.documents) {
                this.categoryDocumentCounts.set(this.currentCategory, this.documents.length);
                console.log('🎯 DEBUG: 更新分类文档数量缓存:', this.currentCategory, '=', this.documents.length);
            }
            
            // 重新渲染分类列表以更新active状态和文档数量
            console.log('🎯 DEBUG: 即将调用 renderCategoriesOnly()');
            this.renderCategoriesOnly();
            
            // 渲染文档列表
            console.log('🎯 DEBUG: 即将调用 renderDocuments()');
            this.renderDocuments();
            
            console.log('🎯 DEBUG: 渲染完成，当前分类 =', this.currentCategory);
            console.log('🎯 DEBUG: 当前文档数量 =', this.documents.length);
            console.log('🎯 DEBUG: 过滤后文档数量 =', this.filteredDocuments.length);
            
        } catch (error) {
            console.error('🎯 DEBUG: 切换分类失败:', error);
            // 发生错误时回滚状态
            this.currentCategory = oldCategory;
            this.renderCategoriesOnly();
        } finally {
            this.isLoadingDocuments = false;
            console.log('🎯 DEBUG: selectCategory 函数执行完毕');
        }
    }

    // 切换分类状态
    async toggleCategory(categoryId) {
        console.log('🔄 DEBUG: toggleCategory 函数被调用！');
        console.log('🔄 DEBUG: categoryId 参数 =', categoryId, '类型:', typeof categoryId);
        console.log('🔄 DEBUG: 调用栈:', new Error().stack.split('\n').slice(1, 4).join('\n'));
        
        const category = this.categories.find(c => c.id === categoryId);
        console.log('🔄 DEBUG: 找到分类 =', category);
        
        if (category) {
            // 切换状态
            const oldStatus = category.status;
            const oldIsPublic = category.is_public;
            
            // 新的切换逻辑：优先切换status，但也考虑is_public
            const currentlyEnabled = (category.is_public !== false && category.status === '1');
            const newStatus = currentlyEnabled ? '0' : '1';
            const newIsPublic = currentlyEnabled ? false : true;
            
            console.log('🔄 DEBUG: 状态变更详情:');
            console.log('  之前: is_public =', oldIsPublic, 'status =', oldStatus, '启用状态 =', currentlyEnabled);
            console.log('  新状态: is_public =', newIsPublic, 'status =', newStatus);
            
            category.status = newStatus;
            category.is_public = newIsPublic;
            console.log('🔄 DEBUG: 本地状态已更新，准备重新渲染');
            
            this.renderCategories();
            
            try {
                console.log('🔄 DEBUG: 准备发送API请求到 /api/v1/rag/collections/update');
                const requestData = { 
                    collection_id: categoryId,
                    status: newStatus,
                    is_public: newIsPublic
                };
                console.log('🔄 DEBUG: 请求数据 =', requestData);
                
                const response = await Utils.request('/api/v1/rag/collections/update', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestData)
                });
                
                console.log('🔄 DEBUG: API响应 =', response);
                
                Utils.showToast(
                    `分类已${newStatus === '1' ? '启用' : '禁用'}`, 
                    'success'
                );
                console.log('🔄 DEBUG: 操作成功完成');
                
                // 🔧 修复：状态更新成功后重新加载当前分类的文档
                if (String(categoryId) === String(this.currentCategory)) {
                    console.log('🔄 DEBUG: 当前分类状态已更新，重新加载文档');
                    await this.loadDocuments();
                    this.renderDocuments();
                    console.log('🔄 DEBUG: 文档已重新加载和渲染');
                }
            } catch (error) {
                console.error('🔄 DEBUG: API请求失败:', error);
                Utils.showToast('操作失败: ' + error.message, 'error');
                // 回滚状态
                category.status = oldStatus;
                this.renderCategories();
                console.log('🔄 DEBUG: 状态已回滚');
            }
        } else {
            console.error('🔄 DEBUG: 未找到指定的分类，categoryId =', categoryId);
        }
    }

    // 过滤分类
    filterCategories(query) {
        const categories = document.querySelectorAll('.knowledge-category');
        categories.forEach(categoryEl => {
            const name = categoryEl.querySelector('h4').textContent.toLowerCase();
            const description = categoryEl.querySelector('p').textContent.toLowerCase();
            const visible = name.includes(query.toLowerCase()) || 
                          description.includes(query.toLowerCase());
            categoryEl.style.display = visible ? 'block' : 'none';
        });
    }

    // 过滤文档
    filterDocuments() {
        const nameFilter = document.querySelector('.filter-input[placeholder*="名称"]')?.value.toLowerCase() || '';
        const statusFilter = document.querySelector('.filter-select')?.value || 'all';
        
        this.filteredDocuments = this.documents.filter(doc => {
            // 名称筛选
            const matchName = !nameFilter || 
                doc.name.toLowerCase().includes(nameFilter) ||
                (doc.title && doc.title.toLowerCase().includes(nameFilter)) ||
                (doc.description && doc.description.toLowerCase().includes(nameFilter));
            
            // 状态筛选  
            const matchStatus = statusFilter === 'all' || doc.status === statusFilter;
            
            // 当前分类筛选
            const matchCategory = !this.currentCategory || 
                doc.category === this.currentCategory ||
                doc.collection_id === this.currentCategory ||
                doc.vector_collection === this.currentCategory ||
                (doc.category && doc.category.includes && doc.category.includes(this.currentCategory));
                
            return matchName && matchStatus && matchCategory;
        });
        
        this.renderDocuments();
    }
    
    // 搜索文档（远程搜索）
    async searchDocuments(query) {
        if (!query.trim()) {
            this.filterDocuments();
            return;
        }
        
        try {
            Utils.showLoading();
            
            const response = await Utils.request(`/api/v1/rag/search/text?query=${encodeURIComponent(query)}&collection_id=${this.currentCategory || ''}`);
            
            if (response.success && response.data) {
                // 将搜索结果转换为文档格式
                this.filteredDocuments = response.data.results.map(result => ({
                    id: result.id,
                    name: result.title,
                    title: result.title,
                    description: result.description,
                    content_type: result.content_type,
                    type: result.content_type,
                    status: 'processed',
                    upload_type: '本地上传',
                    created_at: result.metadata?.upload_time,
                    file_size: result.metadata?.file_size,
                    mime_type: result.metadata?.mime_type,
                    category: result.metadata?.collection_id,
                    similarity_score: result.similarity_score,
                    snippet: result.snippet
                }));
                
                this.renderDocuments();
                Utils.showToast(`找到 ${this.filteredDocuments.length} 个相关文档`, 'success');
            }
            
        } catch (error) {
            console.error('搜索失败:', error);
            Utils.showToast('搜索失败: ' + error.message, 'error');
            this.filterDocuments(); // 回退到本地筛选
        } finally {
            Utils.hideLoading();
        }
    }
    
    // 智能搜索（支持语义搜索和关键词搜索）
    async smartSearch(query) {
        if (!query.trim()) {
            this.filteredDocuments = [...this.documents];
            this.filterDocuments();
            return;
        }
        
        // 先进行本地筛选（即时响应）
        this.filteredDocuments = this.documents.filter(doc => {
            return doc.name.toLowerCase().includes(query.toLowerCase()) ||
                   (doc.title && doc.title.toLowerCase().includes(query.toLowerCase())) ||
                   (doc.description && doc.description.toLowerCase().includes(query.toLowerCase()));
        });
        this.renderDocuments();
        
        // 然后进行远程语义搜索
        try {
            const response = await Utils.request(`/api/v1/rag/search/text?query=${encodeURIComponent(query)}&collection_id=${this.currentCategory || ''}`);
            
            if (response.success && response.data && response.data.results.length > 0) {
                // 合并本地筛选和语义搜索结果
                const semanticResults = response.data.results.map(result => ({
                    id: result.id,
                    name: result.title,
                    title: result.title,
                    description: result.description,
                    content_type: result.content_type,
                    type: result.content_type,
                    status: 'processed',
                    upload_type: '本地上传',
                    created_at: result.metadata?.upload_time,
                    file_size: result.metadata?.file_size,
                    mime_type: result.metadata?.mime_type,
                    category: result.metadata?.collection_id,
                    similarity_score: result.similarity_score,
                    snippet: result.snippet,
                    isSemanticResult: true
                }));
                
                // 去重并合并结果
                const existingIds = new Set(this.filteredDocuments.map(doc => doc.id));
                const newResults = semanticResults.filter(doc => !existingIds.has(doc.id));
                
                this.filteredDocuments = [...this.filteredDocuments, ...newResults];
                this.renderDocuments();
            }
            
        } catch (error) {
            console.error('语义搜索失败:', error);
        }
    }

    // 显示上传模态框
    showUploadModal() {
        const modal = document.createElement('div');
        modal.className = 'upload-modal';
        modal.innerHTML = `
            <div class="upload-modal-content">
                <div class="modal-header">
                    <h3 class="modal-title">上传文档</h3>
                    <button class="modal-close" onclick="this.parentElement.parentElement.parentElement.remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="upload-area" onclick="document.getElementById('fileInput').click()">
                    <i class="fas fa-cloud-upload-alt"></i>
                    <h4>点击或拖拽文件到这里上传</h4>
                    <p>支持 PDF, Word, PPT, 图片, 音频, 视频, 文本 等格式</p>
                    <button class="btn btn-outline">选择文件</button>
                </div>
                
                <input type="file" id="fileInput" class="file-input" multiple 
                       accept=".pdf,.doc,.docx,.ppt,.pptx,.jpg,.jpeg,.png,.mp3,.mp4,.txt,.md">
                
                <div class="file-preview" id="filePreview" style="display: none;">
                    <h4>选中的文件：</h4>
                    <div class="file-list" id="fileList"></div>
                </div>
                
                <div class="form-group">
                    <label>选择分类</label>
                    <select class="form-control" id="categorySelect">
                        ${this.categories.length > 0 ? 
                            this.categories.map((cat, index) => `
                                <option value="${cat.id}" ${index === 0 ? 'selected' : ''}>${cat.name}</option>
                            `).join('') :
                            '<option value="">暂无可用分类</option>'
                        }
                    </select>
                </div>
                
                <div id="batchUploadProgress" class="batch-upload" hidden></div>
                <div class="upload-progress" id="uploadProgress" style="display: none;">
                    <div class="progress-bar">
                        <div class="progress-fill" id="progressFill"></div>
                    </div>
                    <div class="progress-text" id="progressText">0%</div>
                </div>
                
                <div class="modal-actions" style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px;">
                    <button class="btn btn-secondary" onclick="this.parentElement.parentElement.parentElement.remove()">取消</button>
                    <button class="btn btn-primary" id="uploadButton" onclick="window.knowledgeBase.handleUpload()">开始上传</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // 拖拽上传
        const uploadArea = modal.querySelector('.upload-area');
        const fileInput = modal.querySelector('#fileInput');
        
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });
        
        uploadArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
        });
        
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            fileInput.files = e.dataTransfer.files;
            this.updateFilePreview(fileInput.files);
        });
        
        // 文件选择预览
        fileInput.addEventListener('change', (e) => {
            this.updateFilePreview(e.target.files);
        });
    }
    
    // 更新文件预览
    updateFilePreview(files) {
        const preview = document.getElementById('filePreview');
        const fileList = document.getElementById('fileList');
        
        if (files.length === 0) {
            preview.style.display = 'none';
            return;
        }
        
        preview.style.display = 'block';
        fileList.innerHTML = '';
        
        Array.from(files).forEach((file, index) => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            fileItem.innerHTML = `
                <div class="file-info">
                    <i class="fas fa-file-alt"></i>
                    <span class="file-name">${file.name}</span>
                    <span class="file-size">${this.formatFileSize(file.size)}</span>
                </div>
                <button class="file-remove" onclick="this.parentElement.remove()">
                    <i class="fas fa-times"></i>
                </button>
            `;
            fileList.appendChild(fileItem);
        });
    }
    
    // 格式化文件大小
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // 处理文件上传
    async handleUpload() {
        const fileInput = document.getElementById('fileInput');
        const categorySelect = document.getElementById('categorySelect');
        if (!fileInput.files.length) return Utils.showToast('请选择要上传的文件', 'warning');
        if (!categorySelect.value) return Utils.showToast('请先创建并选择知识库分类', 'warning');
        const modal = fileInput.closest('.upload-modal');
        const controls = Array.from(modal.querySelectorAll('button, input, select'));
        controls.forEach(control => control.disabled = true);
        modal.querySelector('.upload-area').style.pointerEvents = 'none';
        const panel = modal.querySelector('#batchUploadProgress');
        try {
            const result = await KnowledgeBatchUpload.run({files: Array.from(fileInput.files), collectionId: categorySelect.value,
                request: (url, options) => Utils.request(url, options),
                onUpdate: snapshot => KnowledgeBatchUpload.render(panel, snapshot)});
            Utils.showToast(`已可检索 ${result.completed} 个文件${result.failed ? `，失败 ${result.failed} 个，请查看详情` : ''}`, result.failed ? 'warning' : 'success');
            if (!result.failed) fileInput.value = '';
            await this.loadDocuments(); this.renderDocuments();
            await this.updateCategoryDocumentCount(categorySelect.value);
        } catch (error) {
            const message = document.createElement('p'); message.setAttribute('role', 'alert');
            message.textContent = error.message; panel.hidden = false; panel.append(message);
        } finally {
            controls.forEach(control => control.disabled = false);
            modal.querySelector('.upload-area').style.pointerEvents = '';
            modal.querySelector('#uploadButton').textContent = '开始上传';
        }
    }

    // 添加文档到向量数据库
    async addToVectorDB(docId) {
        try {
            const response = await Utils.request(`/api/v1/rag/vector/add`, {
                method: 'POST',
                body: JSON.stringify({
                    document_id: docId
                })
            });
            
            if (response.success) {
                console.log(`文档 ${docId} 成功添加到向量数据库`);
                return true;
            } else {
                console.warn(`文档 ${docId} 添加到向量数据库失败`);
                return false;
            }
            
        } catch (error) {
            console.error(`向量化失败: ${error.message}`);
            return false;
        }
    }
    
    // 分析文档内容（生成摘要和标签）
    async analyzeContent(docId) {
        try {
            Utils.showLoading();
            
            const response = await Utils.request(`/api/v1/rag/content-analysis/analyze`, {
                method: 'POST',
                body: JSON.stringify({
                    content_id: docId,
                    analysis_type: 'both'
                })
            });
            
            if (response.success) {
                Utils.showToast('内容分析完成', 'success');
                
                // 重新加载文档列表以显示新的摘要和标签
                await this.loadDocuments();
                this.renderDocuments();
            } else {
                Utils.showToast('内容分析失败', 'error');
            }
            
        } catch (error) {
            Utils.showToast('分析失败: ' + error.message, 'error');
        } finally {
            Utils.hideLoading();
        }
    }
    
    // 批量分析选中的文档
    async batchAnalyzeContent() {
        const checkboxes = document.querySelectorAll('.document-checkbox:checked');
        const selectedIds = Array.from(checkboxes).map(cb => cb.value);
        
        if (selectedIds.length === 0) {
            Utils.showToast('请选择要分析的文档', 'warning');
            return;
        }
        
        const confirmMessage = `确定要分析选中的 ${selectedIds.length} 个文档吗？这可能需要一些时间。`;
        if (!confirm(confirmMessage)) return;
        
        try {
            Utils.showLoading();
            
            const response = await Utils.request(`/api/v1/rag/content-analysis/batch-analyze`, {
                method: 'POST',
                body: JSON.stringify(selectedIds)
            });
            
            if (response.success) {
                const successCount = response.result.success_count;
                const totalCount = response.result.total;
                Utils.showToast(`批量分析完成：成功 ${successCount}/${totalCount} 个文档`, 'success');
                
                // 重新加载文档列表
                await this.loadDocuments();
                this.renderDocuments();
            } else {
                Utils.showToast('批量分析失败', 'error');
            }
            
        } catch (error) {
            Utils.showToast('批量分析失败: ' + error.message, 'error');
        } finally {
            Utils.hideLoading();
        }
    }
    
    // 查看文档详情
    viewDocument(docId) {
        const doc = this.documents.find(d => d.id === docId) || 
                   this.filteredDocuments.find(d => d.id === docId);
        
        if (!doc) {
            Utils.showToast('文档不存在', 'error');
            return;
        }
        
        const modal = document.createElement('div');
        modal.className = 'upload-modal';
        modal.innerHTML = `
            <div class="upload-modal-content document-detail-modal">
                <div class="modal-header">
                    <h3 class="modal-title">文档详情</h3>
                    <button class="modal-close" onclick="this.parentElement.parentElement.parentElement.remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="document-detail">
                    <div class="detail-section">
                        <div class="detail-item">
                            <label>文档名称</label>
                            <div class="detail-value">${doc.name || doc.title}</div>
                        </div>
                        
                        <div class="detail-item">
                            <label>描述</label>
                            <div class="detail-value">${doc.description || '暂无描述'}</div>
                        </div>
                        
                        <div class="detail-item">
                            <label>所属分类</label>
                            <div class="detail-value">${doc.category || doc.vector_collection || '未分类'}</div>
                        </div>
                        
                        <div class="detail-item">
                            <label>文件大小</label>
                            <div class="detail-value">${this.formatFileSize(doc.file_size)}</div>
                        </div>
                        
                        <div class="detail-item">
                            <label>上传时间</label>
                            <div class="detail-value">${this.formatDate(doc.created_at)}</div>
                        </div>
                        
                        <div class="detail-item">
                            <label>状态</label>
                            <div class="detail-value">
                                <span class="status ${doc.status}">${this.getStatusText(doc.status)}</span>
                            </div>
                        </div>
                        
                        ${doc.summary ? `
                        <div class="detail-item">
                            <label>内容摘要</label>
                            <div class="detail-value content-summary">${doc.summary}</div>
                        </div>
                        ` : ''}
                        
                        ${doc.tags && doc.tags.length > 0 ? `
                        <div class="detail-item">
                            <label>内容标签</label>
                            <div class="detail-value content-tags">
                                ${doc.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
                            </div>
                        </div>
                        ` : ''}
                        
                        ${doc.snippet ? `
                        <div class="detail-item">
                            <label>内容预览</label>
                            <div class="detail-value content-preview">${doc.snippet}</div>
                        </div>
                        ` : ''}
                        
                        ${doc.similarity_score ? `
                        <div class="detail-item">
                            <label>相似度分数</label>
                            <div class="detail-value">${(doc.similarity_score * 100).toFixed(2)}%</div>
                        </div>
                        ` : ''}
                    </div>
                </div>
                
                <div class="modal-actions">
                    <button class="btn btn-secondary" onclick="window.knowledgeBase.editDocument('${docId}')">编辑</button>
                    <button class="btn btn-secondary" onclick="window.knowledgeBase.analyzeContent('${docId}')">智能分析</button>
                    <button class="btn btn-secondary" onclick="window.knowledgeBase.downloadDocument('${docId}')">下载</button>
                    <button class="btn btn-danger" onclick="window.knowledgeBase.deleteDocument('${docId}')">删除</button>
                    <button class="btn btn-primary" onclick="this.parentElement.parentElement.parentElement.remove()">关闭</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }
    
    // 编辑文档
    editDocument(docId) {
        const doc = this.documents.find(d => d.id === docId) || 
                   this.filteredDocuments.find(d => d.id === docId);
        
        if (!doc) {
            Utils.showToast('文档不存在', 'error');
            return;
        }
        
        const modal = document.createElement('div');
        modal.className = 'upload-modal';
        modal.innerHTML = `
            <div class="upload-modal-content">
                <div class="modal-header">
                    <h3 class="modal-title">编辑文档</h3>
                    <button class="modal-close" onclick="this.parentElement.parentElement.parentElement.remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="form-group">
                    <label>文档名称</label>
                    <input type="text" class="form-control" id="editDocName" value="${doc.name || doc.title}" placeholder="请输入文档名称">
                </div>
                
                <div class="form-group">
                    <label>描述</label>
                    <textarea class="form-control" id="editDocDesc" placeholder="请输入描述信息" rows="3">${doc.description || ''}</textarea>
                </div>
                
                <div class="form-group">
                    <label>所属分类</label>
                    <select class="form-control" id="editDocCategory">
                        ${this.categories.map(cat => `
                            <option value="${cat.id}" ${(doc.category === cat.id || doc.vector_collection === cat.id) ? 'selected' : ''}>
                                ${cat.name}
                            </option>
                        `).join('')}
                    </select>
                </div>
                
                <div class="form-group">
                    <label>内容摘要</label>
                    <textarea class="form-control" id="editDocSummary" placeholder="请输入或编辑内容摘要" rows="4">${doc.summary || ''}</textarea>
                    <small class="form-text">您可以手动编辑AI生成的摘要，或点击"重新分析"按钮让AI重新生成</small>
                </div>
                
                <div class="form-group">
                    <label>内容标签</label>
                    <input type="text" class="form-control" id="editDocTags" value="${Array.isArray(doc.tags) ? doc.tags.join(', ') : ''}" placeholder="请输入标签，用逗号分隔">
                    <small class="form-text">用英文逗号分隔多个标签，例如：智慧园区, AI视频分析, IoT联动</small>
                </div>
                
                <div class="modal-actions">
                    <button class="btn btn-secondary" onclick="this.parentElement.parentElement.parentElement.remove()">取消</button>
                    <button class="btn btn-secondary" onclick="window.knowledgeBase.reAnalyzeContent('${docId}')">重新分析</button>
                    <button class="btn btn-primary" onclick="window.knowledgeBase.updateDocument('${docId}')">保存</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }
    
    // 更新文档
    async updateDocument(docId) {
        const name = document.getElementById('editDocName').value.trim();
        const description = document.getElementById('editDocDesc').value.trim();
        const category = document.getElementById('editDocCategory').value;
        const summary = document.getElementById('editDocSummary').value.trim();
        const tagsText = document.getElementById('editDocTags').value.trim();
        
        // 解析标签
        const tags = tagsText ? tagsText.split(',').map(tag => tag.trim()).filter(tag => tag) : [];
        
        if (!name) {
            Utils.showToast('请输入文档名称', 'warning');
            return;
        }
        
        try {
            Utils.showLoading();
            
            await Utils.request('/api/v1/rag/documents/update', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    document_id: docId,
                    title: name,
                    description,
                    vector_collection: category,
                    content_summary: summary,
                    content_tags: tags
                })
            });
            
            Utils.showToast('文档更新成功', 'success');
            document.querySelector('.upload-modal').remove();
            
            await this.loadDocuments();
            this.renderDocuments();
            
        } catch (error) {
            Utils.showToast('更新失败: ' + error.message, 'error');
        } finally {
            Utils.hideLoading();
        }
    }
    
    // 重新分析内容并更新编辑表单
    async reAnalyzeContent(docId) {
        try {
            Utils.showLoading('正在重新分析内容...');
            
            const response = await Utils.request(`/api/v1/rag/content-analysis/analyze`, {
                method: 'POST',
                body: JSON.stringify({
                    content_id: docId,
                    analysis_type: 'both'
                })
            });
            
            if (response.success && response.result) {
                // 更新表单中的摘要和标签
                const summaryField = document.getElementById('editDocSummary');
                const tagsField = document.getElementById('editDocTags');
                
                if (response.result.summary && summaryField) {
                    summaryField.value = response.result.summary;
                }
                
                if (response.result.tags && tagsField) {
                    tagsField.value = Array.isArray(response.result.tags) ? response.result.tags.join(', ') : '';
                }
                
                Utils.showToast('内容重新分析完成，请检查并保存', 'success');
            } else {
                Utils.showToast('重新分析失败', 'error');
            }
            
        } catch (error) {
            Utils.showToast('重新分析失败: ' + error.message, 'error');
        } finally {
            Utils.hideLoading();
        }
    }
    
    // 下载文档
    async downloadDocument(docId) {
        try {
            Utils.showLoading();
            
            const response = await fetch('/api/v1/rag/documents/download', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ document_id: docId })
            });
            
            if (!response.ok) {
                throw new Error('下载失败');
            }
            
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `document_${docId}`;
            a.click();
            window.URL.revokeObjectURL(url);
            
            Utils.showToast('下载成功', 'success');
            
        } catch (error) {
            Utils.showToast('下载失败: ' + error.message, 'error');
        } finally {
            Utils.hideLoading();
        }
    }
    
    // 显示文档菜单
    showDocumentMenu(docId, event) {
        event.stopPropagation();
        
        // 移除已存在的菜单
        const existingMenu = document.querySelector('.document-menu');
        if (existingMenu) {
            existingMenu.remove();
        }
        
        const menu = document.createElement('div');
        menu.className = 'document-menu';
        menu.innerHTML = `
            <div class="menu-item" onclick="window.knowledgeBase.duplicateDocument('${docId}')">
                <i class="fas fa-copy"></i> 复制
            </div>
            <div class="menu-item" onclick="window.knowledgeBase.moveDocument('${docId}')">
                <i class="fas fa-folder"></i> 移动到...
            </div>
            <div class="menu-item" onclick="window.knowledgeBase.shareDocument('${docId}')">
                <i class="fas fa-share"></i> 分享
            </div>
            <div class="menu-item danger" onclick="window.knowledgeBase.deleteDocument('${docId}')">
                <i class="fas fa-trash"></i> 删除
            </div>
        `;
        
        // 定位菜单
        const rect = event.target.getBoundingClientRect();
        menu.style.position = 'absolute';
        menu.style.top = rect.bottom + 'px';
        menu.style.left = rect.left + 'px';
        menu.style.zIndex = '1000';
        
        document.body.appendChild(menu);
        
        // 点击其他地方关闭菜单
        setTimeout(() => {
            document.addEventListener('click', function closeMenu() {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            });
        }, 100);
    }
    
    // 删除文档
    async deleteDocument(docId) {
        const doc = this.documents.find(d => d.id === docId);
        const confirmMessage = `确定要删除文档"${doc?.name || doc?.title || docId}"吗？此操作不可恢复。`;
        
        if (!confirm(confirmMessage)) return;
        
        try {
            Utils.showLoading();
            
            await Utils.request('/api/v1/rag/documents/delete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ document_id: docId })
            });
            
            Utils.showToast('文档删除成功', 'success');
            
            // 关闭可能存在的详情模态框
            const modal = document.querySelector('.upload-modal');
            if (modal) modal.remove();
            
            await this.loadDocuments();
            this.renderDocuments();
            
        } catch (error) {
            Utils.showToast('删除失败: ' + error.message, 'error');
        } finally {
            Utils.hideLoading();
        }
    }
    
    // 复制文档
    async duplicateDocument(docId) {
        try {
            await Utils.request('/api/v1/rag/documents/duplicate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ document_id: docId })
            });
            
            Utils.showToast('文档复制成功', 'success');
            await this.loadDocuments();
            this.renderDocuments();
            
        } catch (error) {
            Utils.showToast('复制失败: ' + error.message, 'error');
        }
    }
    
    // 移动文档
    moveDocument(docId) {
        const modal = document.createElement('div');
        modal.className = 'upload-modal';
        modal.innerHTML = `
            <div class="upload-modal-content">
                <div class="modal-header">
                    <h3 class="modal-title">移动文档</h3>
                    <button class="modal-close" onclick="this.parentElement.parentElement.parentElement.remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="form-group">
                    <label>选择目标分类</label>
                    <select class="form-control" id="moveDocCategory">
                        ${this.categories.map(cat => `
                            <option value="${cat.id}">${cat.name}</option>
                        `).join('')}
                    </select>
                </div>
                
                <div class="modal-actions">
                    <button class="btn btn-secondary" onclick="this.parentElement.parentElement.parentElement.remove()">取消</button>
                    <button class="btn btn-primary" onclick="window.knowledgeBase.executeMove('${docId}')">移动</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }
    
    // 执行移动
    async executeMove(docId) {
        const newCategory = document.getElementById('moveDocCategory').value;
        
        try {
            await Utils.request('/api/v1/rag/documents/move', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    document_id: docId,
                    collection_id: newCategory
                })
            });
            
            Utils.showToast('文档移动成功', 'success');
            document.querySelector('.upload-modal').remove();
            
            await this.loadDocuments();
            this.renderDocuments();
            
        } catch (error) {
            Utils.showToast('移动失败: ' + error.message, 'error');
        }
    }
    
    // 分享文档
    shareDocument(docId) {
        const shareUrl = `${window.location.origin}/static/document-view.html?id=${docId}`;
        
        if (navigator.share) {
            navigator.share({
                title: '分享文档',
                url: shareUrl
            });
        } else if (navigator.clipboard) {
            navigator.clipboard.writeText(shareUrl);
            Utils.showToast('分享链接已复制到剪贴板', 'success');
        } else {
            prompt('复制分享链接:', shareUrl);
        }
    }
    
    // 辅助函数：截断文本
    truncateText(text, maxLength) {
        if (!text || text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    }
    
    // 辅助函数：格式化日期
    formatDate(dateString) {
        if (!dateString) return '--';
        const date = new Date(dateString);
        return date.toLocaleDateString('zh-CN') + ' ' + date.toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    // 编辑分类
    editCategory(categoryId) {
        const category = this.categories.find(c => c.id === categoryId);
        if (!category) return;
        
        const modal = document.createElement('div');
        modal.className = 'upload-modal';
        modal.innerHTML = `
            <div class="upload-modal-content">
                <div class="modal-header">
                    <h3 class="modal-title">编辑知识库</h3>
                    <button class="modal-close" onclick="this.parentElement.parentElement.parentElement.remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="form-group">
                    <label>知识库名称</label>
                    <input type="text" class="form-control" id="editCategoryName" value="${category.name}" placeholder="请输入知识库名称">
                </div>
                
                <div class="form-group">
                    <label>描述</label>
                    <textarea class="form-control" id="editCategoryDesc" placeholder="请输入描述信息" rows="3">${category.description || ''}</textarea>
                </div>
                
                <div class="modal-actions" style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px;">
                    <button class="btn btn-secondary" onclick="this.parentElement.parentElement.parentElement.remove()">取消</button>
                    <button class="btn btn-primary" onclick="window.knowledgeBase.updateCategory('${categoryId}')">保存</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }
    
    // 更新分类
    async updateCategory(categoryId) {
        const name = document.getElementById('editCategoryName').value.trim();
        const description = document.getElementById('editCategoryDesc').value.trim();
        
        if (!name) {
            Utils.showToast('请输入知识库名称', 'warning');
            return;
        }
        
        try {
            Utils.showLoading();
            
            await Utils.request('/api/v1/rag/collections/update', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    collection_id: categoryId,
                    name,
                    description
                })
            });
            
            Utils.showToast('知识库更新成功', 'success');
            document.querySelector('.upload-modal').remove();
            
            await this.loadCategories();
            this.renderCategories();
            
        } catch (error) {
            Utils.showToast('更新失败: ' + error.message, 'error');
        } finally {
            Utils.hideLoading();
        }
    }
    
    // 显示分类菜单
    showCategoryMenu(categoryId, event) {
        event.stopPropagation();
        
        // 移除已存在的菜单
        const existingMenu = document.querySelector('.category-menu');
        if (existingMenu) {
            existingMenu.remove();
        }
        
        const menu = document.createElement('div');
        menu.className = 'category-menu';
        menu.innerHTML = `
            <div class="menu-item" onclick="window.knowledgeBase.editCategory('${categoryId}')">
                <i class="fas fa-edit"></i> 编辑
            </div>
            <div class="menu-item" onclick="window.knowledgeBase.duplicateCategory('${categoryId}')">
                <i class="fas fa-copy"></i> 复制
            </div>
            <div class="menu-item danger" onclick="window.knowledgeBase.deleteCategory('${categoryId}')">
                <i class="fas fa-trash"></i> 删除
            </div>
        `;
        
        // 定位菜单
        const rect = event.target.getBoundingClientRect();
        menu.style.position = 'absolute';
        menu.style.top = rect.bottom + 'px';
        menu.style.left = rect.left + 'px';
        menu.style.zIndex = '1000';
        
        document.body.appendChild(menu);
        
        // 点击其他地方关闭菜单
        setTimeout(() => {
            document.addEventListener('click', function closeMenu() {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            });
        }, 100);
    }
    
    // 复制分类
    async duplicateCategory(categoryId) {
        const category = this.categories.find(c => c.id === categoryId);
        if (!category) return;
        
        try {
            await Utils.request('/api/v1/rag/collections/', {
                method: 'POST',
                body: JSON.stringify({
                    name: `${category.name} (副本)`,
                    description: category.description,
                    collection_type: category.collection_type || 'text'
                })
            });
            
            Utils.showToast('知识库复制成功', 'success');
            await this.loadCategories();
            this.renderCategories();
            
        } catch (error) {
            Utils.showToast('复制失败: ' + error.message, 'error');
        }
    }
    
    // 删除分类
    async deleteCategory(categoryId) {
        const category = this.categories.find(c => c.id === categoryId);
        if (!category) return;
        
        const docCount = this.getDocumentCountForCategory(categoryId);
        const confirmMessage = docCount > 0 
            ? `确定要删除知识库"${category.name}"吗？这将同时删除该库中的 ${docCount} 个文档。`
            : `确定要删除知识库"${category.name}"吗？`;
        
        if (!confirm(confirmMessage)) return;
        
        try {
            Utils.showLoading();
            
            await Utils.request('/api/v1/rag/collections/delete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ collection_id: categoryId })
            });
            
            Utils.showToast('知识库删除成功', 'success');
            
            // 如果删除的是当前选中的分类，切换到第一个分类
            if (this.currentCategory === categoryId) {
                this.currentCategory = null;
            }
            
            await this.loadCategories();
            await this.loadDocuments();
            this.renderCategories();
            this.renderDocuments();
            
        } catch (error) {
            Utils.showToast('删除失败: ' + error.message, 'error');
        } finally {
            Utils.hideLoading();
        }
    }

    // 创建新分类
    showCreateCategoryModal() {
        const modal = document.createElement('div');
        modal.className = 'upload-modal';
        modal.innerHTML = `
            <div class="upload-modal-content">
                <div class="modal-header">
                    <h3 class="modal-title">新建知识库</h3>
                    <button class="modal-close" onclick="this.parentElement.parentElement.parentElement.remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="form-group">
                    <label>知识库名称</label>
                    <input type="text" class="form-control" id="categoryName" placeholder="请输入知识库名称">
                </div>
                
                <div class="form-group">
                    <label>描述</label>
                    <textarea class="form-control" id="categoryDesc" placeholder="请输入描述信息" rows="3"></textarea>
                </div>
                
                <div class="modal-actions" style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px;">
                    <button class="btn btn-secondary" onclick="this.parentElement.parentElement.parentElement.remove()">取消</button>
                    <button class="btn btn-primary" onclick="window.knowledgeBase.createCategory()">创建</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }

    // 创建分类
    async createCategory() {
        const name = document.getElementById('categoryName').value;
        const description = document.getElementById('categoryDesc').value;
        
        if (!name) {
            Utils.showToast('请输入知识库名称', 'warning');
            return;
        }
        
        try {
            Utils.showLoading();
            
            await Utils.request('/api/v1/rag/collections/', {
                method: 'POST',
                body: JSON.stringify({
                    name,
                    description,
                    collection_type: 'text'
                })
            });
            
            Utils.showToast('知识库创建成功', 'success');
            document.querySelector('.upload-modal').remove();
            
            await this.loadCategories();
            this.renderCategories();
            
        } catch (error) {
            Utils.showToast('创建失败: ' + error.message, 'error');
        } finally {
            Utils.hideLoading();
        }
    }

    // 批量操作
    toggleBatchActions() {
        const checkboxes = document.querySelectorAll('.document-checkbox');
        const selectedIds = Array.from(checkboxes)
            .filter(cb => cb.checked)
            .map(cb => cb.value);
            
        if (selectedIds.length === 0) {
            Utils.showToast('请选择要操作的文档', 'warning');
            return;
        }
        
        // 显示批量操作菜单
        const menu = document.createElement('div');
        menu.className = 'batch-menu';
        menu.innerHTML = `
            <div class="dropdown-menu">
                <button onclick="window.knowledgeBase.batchDelete([${selectedIds.join(',')}])">批量删除</button>
                <button onclick="window.knowledgeBase.batchMove([${selectedIds.join(',')}])">移动到...</button>
            </div>
        `;
        
        // 添加批量操作菜单显示逻辑
        const batchBtn = document.getElementById('batchBtn');
        if (batchBtn) {
            const rect = batchBtn.getBoundingClientRect();
            menu.style.position = 'absolute';
            menu.style.top = rect.bottom + 'px';
            menu.style.left = rect.left + 'px';
            menu.style.zIndex = '1000';
            
            document.body.appendChild(menu);
            
            // 点击其他地方关闭菜单
            setTimeout(() => {
                document.addEventListener('click', function closeMenu() {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                });
            }, 100);
        }
    }
    
    // 添加全局键盘快捷键
    initGlobalShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd + N: 新建分类
            if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
                e.preventDefault();
                this.showCreateCategoryModal();
            }
            
            // Ctrl/Cmd + U: 上传文档
            if ((e.ctrlKey || e.metaKey) && e.key === 'u') {
                e.preventDefault();
                this.showUploadModal();
            }
            
            // Ctrl/Cmd + R: 刷新页面数据
            if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
                e.preventDefault();
                this.refreshData();
            }
            
            // ESC: 关闭模态框
            if (e.key === 'Escape') {
                const modal = document.querySelector('.upload-modal');
                if (modal) {
                    modal.remove();
                }
            }
            
            // Delete: 删除选中的文档
            if (e.key === 'Delete') {
                const selected = document.querySelectorAll('.document-checkbox:checked');
                if (selected.length > 0) {
                    e.preventDefault();
                    this.batchDelete(Array.from(selected).map(cb => cb.value));
                }
            }
        });
    }
    
    // 刷新数据
    async refreshData() {
        try {
            Utils.showLoading();
            await Promise.all([
                this.loadCategories(),
                this.loadDocuments()
            ]);
            this.renderCategories();
            this.renderDocuments();
            Utils.showToast('数据刷新成功', 'success');
        } catch (error) {
            Utils.showToast('刷新失败: ' + error.message, 'error');
        } finally {
            Utils.hideLoading();
        }
    }
    
    // 添加选择快捷操作
    addSelectionHelpers() {
        // 全选/取消全选
        const selectAllBtn = document.createElement('button');
        selectAllBtn.className = 'btn btn-sm btn-secondary select-all-btn';
        selectAllBtn.innerHTML = '<i class="fas fa-check-square"></i> 全选';
        selectAllBtn.onclick = () => this.toggleSelectAll();
        
        const toolbar = document.querySelector('.toolbar-actions');
        if (toolbar && !toolbar.querySelector('.select-all-btn')) {
            toolbar.insertBefore(selectAllBtn, toolbar.firstChild);
        }
    }
    
    // 切换全选状态
    toggleSelectAll() {
        const checkboxes = document.querySelectorAll('.document-checkbox');
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
        
        checkboxes.forEach(cb => {
            cb.checked = !allChecked;
        });
        
        this.updateSelectionUI();
    }
    
    // 更新选择UI状态
    updateSelectionUI() {
        const checkboxes = document.querySelectorAll('.document-checkbox');
        const selectedCount = Array.from(checkboxes).filter(cb => cb.checked).length;
        
        const batchBtn = document.getElementById('batchBtn');
        if (batchBtn) {
            batchBtn.textContent = selectedCount > 0 
                ? `批量操作 (${selectedCount})` 
                : '批量操作';
            batchBtn.disabled = selectedCount === 0;
        }
    }
    
    // 初始化工具提示
    initTooltips() {
        document.addEventListener('mouseover', (e) => {
            if (e.target.hasAttribute('title') && !e.target.hasAttribute('data-tooltip-added')) {
                e.target.setAttribute('data-tooltip-added', 'true');
            }
        });
    }
    
    // 添加页面可见性变化处理
    initVisibilityChange() {
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                console.log('页面重新可见');
            }
        });
    }
    
    // 批量删除文档
    async batchDelete(docIds) {
        if (!docIds || docIds.length === 0) return;
        
        const confirmMessage = `确定要删除选中的 ${docIds.length} 个文档吗？此操作不可恢复。`;
        if (!confirm(confirmMessage)) return;
        
        try {
            Utils.showLoading();
            
            const results = await Promise.allSettled(
                docIds.map(id => Utils.request('/api/v1/rag/documents/delete', { 
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ document_id: id })
                }))
            );
            
            const successCount = results.filter(r => r.status === 'fulfilled').length;
            const failCount = results.length - successCount;
            
            if (successCount > 0) {
                Utils.showToast(
                    `成功删除 ${successCount} 个文档${failCount > 0 ? `，失败 ${failCount} 个` : ''}`, 
                    'success'
                );
            } else {
                Utils.showToast('批量删除失败', 'error');
            }
            
            await this.loadDocuments();
            this.renderDocuments();
            
        } catch (error) {
            Utils.showToast('批量删除失败: ' + error.message, 'error');
        } finally {
            Utils.hideLoading();
        }
    }
    
    // 批量移动文档
    async batchMove(docIds) {
        if (!docIds || docIds.length === 0) return;
        
        const modal = document.createElement('div');
        modal.className = 'upload-modal';
        modal.innerHTML = `
            <div class="upload-modal-content">
                <div class="modal-header">
                    <h3 class="modal-title">批量移动文档 (${docIds.length}个)</h3>
                    <button class="modal-close" onclick="this.parentElement.parentElement.parentElement.remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="form-group">
                    <label>选择目标分类</label>
                    <select class="form-control" id="batchMoveCategory">
                        ${this.categories.map(cat => `
                            <option value="${cat.id}">${cat.name}</option>
                        `).join('')}
                    </select>
                </div>
                
                <div class="modal-actions">
                    <button class="btn btn-secondary" onclick="this.parentElement.parentElement.parentElement.remove()">取消</button>
                    <button class="btn btn-primary" onclick="window.knowledgeBase.executeBatchMove(${JSON.stringify(docIds)})">移动</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }
    
    // 执行批量移动
    async executeBatchMove(docIds) {
        const newCategory = document.getElementById('batchMoveCategory').value;
        
        try {
            Utils.showLoading();
            
            const results = await Promise.allSettled(
                docIds.map(id => Utils.request('/api/v1/rag/documents/move', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        document_id: id,
                        collection_id: newCategory
                    })
                }))
            );
            
            const successCount = results.filter(r => r.status === 'fulfilled').length;
            const failCount = results.length - successCount;
            
            if (successCount > 0) {
                Utils.showToast(
                    `成功移动 ${successCount} 个文档${failCount > 0 ? `，失败 ${failCount} 个` : ''}`, 
                    'success'
                );
            } else {
                Utils.showToast('批量移动失败', 'error');
            }
            
            document.querySelector('.upload-modal').remove();
            await this.loadDocuments();
            this.renderDocuments();
            
        } catch (error) {
            Utils.showToast('批量移动失败: ' + error.message, 'error');
        } finally {
            Utils.hideLoading();
        }
    }
}

// ===================== 智能搜索功能 =====================

// 切换搜索选项面板
function toggleSearchOptions() {
    const panel = document.getElementById('searchOptionsPanel');
    const isHidden = panel.classList.contains('hidden');
    
    if (isHidden) {
        panel.classList.remove('hidden');
        // 更新相似度阈值显示
        updateThresholdDisplay();
        // 检查搜索状态
        checkSearchStatus();
    } else {
        panel.classList.add('hidden');
    }
}

// 关闭搜索选项面板
function closeSearchOptions() {
    document.getElementById('searchOptionsPanel').classList.add('hidden');
}

// 更新相似度阈值显示
function updateThresholdDisplay() {
    const slider = document.getElementById('similarityThreshold');
    const display = document.getElementById('thresholdValue');
    
    slider.addEventListener('input', function() {
        display.textContent = this.value;
    });
}

// 执行全局搜索 (顶部搜索框)
function performGlobalSearch() {
    const query = document.getElementById('globalSearchInput').value.trim();
    if (!query) return;
    
    // 切换到智能搜索模式
    knowledgeBase.searchMode = 'intelligent';
    
    // 设置搜索参数并执行
    document.getElementById('searchTypeSelect').value = 'hybrid';
    document.getElementById('searchTopK').value = '10';
    
    performAdvancedSearch(query);
}

// 执行高级搜索
async function performAdvancedSearch(customQuery = null) {
    const query = customQuery || document.getElementById('globalSearchInput').value.trim();
    const searchType = document.getElementById('searchTypeSelect').value;
    const topK = document.getElementById('searchTopK').value;
    const threshold = document.getElementById('similarityThreshold').value;

    if (!query) {
        alert('请输入搜索内容');
        return;
    }

    try {
        // 显示加载状态
        showSearchLoading();

        // 关闭搜索选项面板
        closeSearchOptions();

        // 获取当前选中的知识库ID
        const collectionId = knowledgeBase.currentCategory ? [knowledgeBase.currentCategory] : [];

        // 使用unified接口进行搜索
        const requestBody = {
            query: query,
            search_mode: searchType,  // 注意：unified接口使用search_mode而非search_type
            top_k: parseInt(topK),
            similarity_threshold: parseFloat(threshold),
            include_content: true,
            include_snippet: true,
            include_metadata: true,
            collection_id: collectionId
        };

        const response = await Utils.request('/api/v1/rag/search/unified', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        console.log('🔍 搜索响应数据:', response);
        console.log('📊 是否有results字段:', response && 'results' in response);
        console.log('📈 results内容:', response?.results);

        // unified接口直接返回数据,不包装在success字段中
        if (response && response.results !== undefined) {
            console.log('✅ 开始显示搜索结果，数量:', response.results.length);
            displaySearchResults(response);
            knowledgeBase.searchMode = 'intelligent';
        } else {
            console.error('❌ 搜索失败，响应格式不正确:', response);
            Utils.showToast('搜索失败: ' + (response?.error || '未知错误'), 'error');
            hideSearchResults();
        }

    } catch (error) {
        console.error('搜索失败:', error);
        Utils.showToast('搜索请求失败: ' + error.message, 'error');
        hideSearchResults();
    }
}

// 显示搜索加载状态
function showSearchLoading() {
    const panel = document.getElementById('searchResultsPanel');
    const content = document.getElementById('searchResultsContent');
    
    panel.classList.remove('hidden');
    content.innerHTML = `
        <div class="search-empty-state">
            <i class="fas fa-spinner fa-spin"></i>
            <h3>正在搜索中...</h3>
            <p>使用AI进行智能语义搜索</p>
        </div>
    `;
}

// 显示搜索结果
function displaySearchResults(data) {
    console.log('🎯 displaySearchResults 开始执行');

    const panel = document.getElementById('searchResultsPanel');
    const content = document.getElementById('searchResultsContent');
    const stats = document.getElementById('searchStatsDisplay');

    if (!panel || !content || !stats) {
        console.error('❌ DOM元素不存在!');
        alert('错误: 搜索结果面板DOM元素未找到');
        return;
    }

    // 移除hidden类
    panel.classList.remove('hidden');
    console.log('🔓 移除hidden类');

    // 强制显示面板 - 确保CSS不会隐藏
    panel.style.display = 'block';
    panel.style.visibility = 'visible';
    panel.style.opacity = '1';
    console.log('💪 强制设置样式: display=block, visibility=visible, opacity=1');

    // 兼容unified接口的返回格式
    const searchMode = data.search_mode || data.search_type || 'unknown';
    const searchTypeText = getSearchTypeText(searchMode);
    const executionInfo = data.execution_info || {};

    console.log('📊 搜索模式:', searchMode, '结果数:', data.total);

    // 更新统计信息
    stats.innerHTML = `
        找到 <strong>${data.total || 0}</strong> 个相关文档 |
        搜索模式: <strong>${searchTypeText}</strong> |
        执行时间: ${executionInfo.execution_time_ms || 'N/A'}ms
    `;

    if (!data.results || data.results.length === 0) {
        content.innerHTML = `
            <div class="search-empty-state">
                <i class="fas fa-search-minus"></i>
                <h3>未找到相关内容</h3>
                <p>尝试使用不同的关键词或搜索模式</p>
                <div style="margin-top: 16px; font-size: 14px; color: #718096;">
                    <strong>搜索词:</strong> "${data.query}" |
                    <strong>搜索模式:</strong> ${searchTypeText}
                </div>
            </div>
        `;
        return;
    }

    // 渲染搜索结果
    try {
        const resultsHtml = data.results.map((result, idx) => {
            const resourceId = result.resource_id || result.id || 'unknown';
            const title = (result.title || '未命名文档').replace(/'/g, "\\'");
            const contentType = result.content_type || 'document';
            const snippet = result.snippet || result.description || '暂无内容预览';
            const searchMode = result.search_mode || result.search_type || '';
            const similarity = result.similarity_score || 0;
            const fileSize = result.metadata?.file_size || 0;
            const uploadTime = result.metadata?.upload_time || '';
            const collectionId = result.collection_id || '';

            return `
                <div class="search-result-item" style="cursor: pointer; margin-bottom: 15px;">
                    <div class="search-result-title">
                        <i class="${getFileIcon(contentType)}"></i>
                        ${title}
                    </div>
                    <div class="search-result-meta">
                        <span><i class="fas fa-tag"></i> ${contentType}</span>
                        ${fileSize ? `<span><i class="fas fa-file"></i> ${formatFileSize(fileSize)}</span>` : ''}
                        ${uploadTime ? `<span><i class="fas fa-clock"></i> ${formatDate(uploadTime)}</span>` : ''}
                        ${collectionId ? `<span><i class="fas fa-folder"></i> ${collectionId.substring(0, 8)}...</span>` : ''}
                    </div>
                    <div class="search-result-snippet">${snippet}</div>
                    <div class="search-result-badges">
                        ${searchMode ? `<span class="search-badge search-badge-${searchMode}">${getSearchTypeText(searchMode)}</span>` : ''}
                        ${similarity > 0 ? `<span class="search-badge search-badge-similarity">相似度: ${(similarity * 100).toFixed(1)}%</span>` : ''}
                    </div>
                </div>
            `;
        }).join('');

        content.innerHTML = resultsHtml;
        console.log('✅ 搜索结果已渲染:', data.results.length, '个结果');
        console.log('✅ HTML长度:', resultsHtml.length, '字符');
        console.log('✅ 面板hidden状态:', panel.classList.contains('hidden'));
        console.log('✅ 面板display:', panel.style.display);

        // 滚动到结果面板
        setTimeout(() => {
            panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
            console.log('📜 已滚动到结果面板');
        }, 100);

        // 添加临时高亮边框帮助定位(3秒后移除)
        panel.style.border = '3px solid #3b82f6';
        setTimeout(() => {
            panel.style.border = '';
        }, 3000);

    } catch (error) {
        console.error('❌ 渲染搜索结果时出错:', error);
        content.innerHTML = `<div style="padding: 20px; background: #fee; border: 2px solid red; border-radius: 8px;">
            <h3 style="color: red;">渲染错误</h3>
            <p>${error.message}</p>
            <pre>${error.stack}</pre>
        </div>`;
    }
}

// 隐藏搜索结果
function hideSearchResults() {
    document.getElementById('searchResultsPanel').classList.add('hidden');
    knowledgeBase.searchMode = 'normal';
}

// 关闭搜索结果
function closeSearchResults() {
    hideSearchResults();
    // 切换回普通文档列表
    knowledgeBase.renderDocuments();
}

// 检查搜索系统状态
async function checkSearchStatus() {
    try {
        const response = await Utils.request('/api/v1/rag/search/stats');
        
        if (response.success) {
            const data = response.result;
            const statusHtml = `
                <div class="status-grid">
                    <div class="status-item">
                        <i class="fas fa-database ${data.vector_db_available ? 'status-available' : 'status-unavailable'}"></i>
                        <span>向量数据库: ${data.vector_db_available ? '可用' : '不可用'}</span>
                    </div>
                    <div class="status-item">
                        <i class="fas fa-brain ${data.embedding_model_available ? 'status-available' : 'status-unavailable'}"></i>
                        <span>嵌入模型: ${data.embedding_model_available ? '可用' : '不可用'}</span>
                    </div>
                    <div class="status-item">
                        <i class="fas fa-magic ${data.features.semantic_search ? 'status-available' : 'status-unavailable'}"></i>
                        <span>语义搜索: ${data.features.semantic_search ? '支持' : '不支持'}</span>
                    </div>
                    <div class="status-item">
                        <i class="fas fa-layer-group ${data.features.hybrid_search ? 'status-available' : 'status-unavailable'}"></i>
                        <span>混合搜索: ${data.features.hybrid_search ? '支持' : '不支持'}</span>
                    </div>
                </div>
            `;
            
            document.getElementById('searchStatusInfo').innerHTML = statusHtml;
        } else {
            document.getElementById('searchStatusInfo').innerHTML = `
                <div style="color: #e53e3e; text-align: center;">
                    <i class="fas fa-exclamation-triangle"></i>
                    无法获取搜索系统状态
                </div>
            `;
        }
    } catch (error) {
        console.error('检查搜索状态失败:', error);
        document.getElementById('searchStatusInfo').innerHTML = `
            <div style="color: #e53e3e; text-align: center;">
                <i class="fas fa-exclamation-triangle"></i>
                搜索系统连接失败
            </div>
        `;
    }
}

// 获取搜索类型文本
function getSearchTypeText(type) {
    const typeMap = {
        'semantic': '语义搜索',
        'keyword': '关键词搜索',
        'hybrid': '混合搜索'
    };
    return typeMap[type] || type;
}

// 获取文件图标
function getFileIcon(type) {
    const iconMap = {
        'document': 'fas fa-file-alt',
        'image': 'fas fa-file-image',
        'video': 'fas fa-file-video',
        'audio': 'fas fa-file-audio',
        'pdf': 'fas fa-file-pdf',
        'text': 'fas fa-file-text'
    };
    return iconMap[type] || 'fas fa-file';
}

// 格式化文件大小
function formatFileSize(bytes) {
    if (!bytes) return '';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

// 格式化日期
function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('zh-CN');
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    window.knowledgeBase = new KnowledgeBase();
});

// 导出KnowledgeBase类
window.KnowledgeBase = KnowledgeBase;