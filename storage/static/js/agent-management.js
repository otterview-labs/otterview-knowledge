// 智能体管理类
class AgentManagement {
    constructor() {
        this.agents = [];
        this.filteredAgents = [];
        this.selectedAgents = new Set();
        this.isLoading = false;
        this.viewMode = 'grid'; // 'grid' | 'list'
        
        // 分页相关
        this.pagination = {
            pageIndex: 0,
            pageSize: 12,
            total: 0,
            sorts: [
                { name: 'updated_at', order: 'desc' }
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
        this.initPagination();
        this.initKeyboardShortcuts();
        
        await this.loadAgents();
        this.renderAgents();
    }

    // 检查认证状态
    checkAuth() {
        if (!Utils.isLoggedIn()) {
            localStorage.setItem('authToken', 'demo_token_for_agent_management');
            console.log('设置临时认证token用于智能体管理演示');
        }
    }

    // 初始化事件监听器
    initEventListeners() {
        // 搜索
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', Utils.debounce((e) => {
                this.handleSearch(e.target.value);
            }, 300));
        }

        // 状态筛选
        const statusFilter = document.getElementById('statusFilter');
        if (statusFilter) {
            statusFilter.addEventListener('change', () => this.handleFilter());
        }

        // 类型筛选
        const typeFilter = document.getElementById('typeFilter');
        if (typeFilter) {
            typeFilter.addEventListener('change', () => this.handleFilter());
        }

        // 视图切换
        const gridView = document.getElementById('gridView');
        const listView = document.getElementById('listView');
        if (gridView && listView) {
            gridView.addEventListener('click', () => this.switchView('grid'));
            listView.addEventListener('click', () => this.switchView('list'));
        }

        // 刷新按钮
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.refreshData());
        }

        // 新建智能体按钮
        const createAgentBtn = document.getElementById('createAgentBtn');
        if (createAgentBtn) {
            createAgentBtn.addEventListener('click', () => this.showCreateAgentModal());
        }

        // 批量操作按钮
        const batchBtn = document.getElementById('batchBtn');
        if (batchBtn) {
            batchBtn.addEventListener('click', () => this.toggleBulkActions());
        }

        // 监听复选框变化
        document.addEventListener('change', (e) => {
            if (e.target.classList.contains('agent-checkbox')) {
                this.handleAgentSelection(e.target);
            }
        });

        // 点击卡片选择
        document.addEventListener('click', (e) => {
            if (e.target.closest('.agent-card') && e.ctrlKey) {
                const card = e.target.closest('.agent-card');
                const checkbox = card.querySelector('.agent-checkbox');
                if (checkbox) {
                    checkbox.checked = !checkbox.checked;
                    this.handleAgentSelection(checkbox);
                }
            }
        });
    }

    // 初始化分页组件
    initPagination() {
        const paginationContainer = document.querySelector('#agent-pagination');
        if (paginationContainer) {
            this.paginationComponent = new PaginationComponent(paginationContainer, {
                pageSize: this.pagination.pageSize,
                onPageChange: (pageIndex, pageSize) => {
                    this.pagination.pageIndex = pageIndex;
                    this.pagination.pageSize = pageSize;
                    this.loadAgents();
                },
                onPageSizeChange: (pageIndex, pageSize) => {
                    this.pagination.pageIndex = pageIndex;
                    this.pagination.pageSize = pageSize;
                    this.loadAgents();
                }
            });
        }
    }

    // 初始化键盘快捷键
    initKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd + N: 新建智能体
            if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
                e.preventDefault();
                this.showCreateAgentModal();
            }
            
            // F5 / Ctrl/Cmd + R: 刷新
            if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key === 'r')) {
                e.preventDefault();
                this.refreshData();
            }
            
            // Ctrl/Cmd + A: 全选
            if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
                e.preventDefault();
                this.selectAll();
            }
            
            // Delete: 删除选中智能体
            if (e.key === 'Delete' && this.selectedAgents.size > 0) {
                e.preventDefault();
                this.bulkDelete();
            }
            
            // 1-4: 切换筛选状态
            if (e.key >= '1' && e.key <= '4' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                const filters = ['', 'active', 'inactive', 'draft'];
                const statusFilter = document.getElementById('statusFilter');
                if (statusFilter) {
                    statusFilter.value = filters[parseInt(e.key) - 1];
                    this.handleFilter();
                }
            }
        });
    }

    // 加载智能体列表
    async loadAgents() {
        if (this.isLoading) return;
        
        this.isLoading = true;
        const loadingIndicator = document.querySelector('#agent-loading');
        
        try {
            if (loadingIndicator) loadingIndicator.style.display = 'block';
            
            // 构建查询条件
            const terms = [...this.pagination.terms];
            
            // 创建分页请求
            const pageRequest = PaginationUtils.createPageRequest(
                this.pagination.pageIndex,
                this.pagination.pageSize,
                this.pagination.sorts,
                terms
            );
            
            console.log('智能体管理: 分页请求 =', pageRequest);
            
            // 尝试使用新的分页API
            try {
                const response = await PaginationUtils.fetchPage('/api/v1/agent/agents/list', pageRequest);
                
                if (response.status === 200 && response.result) {
                    this.agents = response.result.data || [];
                    this.pagination.total = response.result.total || 0;
                    this.filteredAgents = [...this.agents];
                    
                    console.log('智能体管理: 新API加载成功, 智能体数量 =', this.agents.length);
                } else {
                    throw new Error('新API响应格式错误');
                }
            } catch (error) {
                console.log('智能体管理: 新API失败，使用模拟数据:', error.message);
                // 使用模拟数据
                this.agents = this.getMockAgents();
                this.filteredAgents = [...this.agents];
                this.pagination.total = this.agents.length;
            }
            
            // 更新分页组件
            if (this.paginationComponent) {
                this.paginationComponent.update(
                    this.pagination.pageIndex,
                    this.pagination.total,
                    this.pagination.pageSize
                );
            }
            
        } catch (error) {
            console.error('智能体管理: 加载智能体失败:', error);
            Utils.showToast('加载智能体失败: ' + error.message, 'error');
            
            // 使用模拟数据作为后备
            this.agents = this.getMockAgents();
            this.filteredAgents = [...this.agents];
            this.pagination.total = this.agents.length;
            
            if (this.paginationComponent) {
                this.paginationComponent.update(0, this.pagination.total, this.pagination.total);
            }
            
        } finally {
            this.isLoading = false;
            if (loadingIndicator) loadingIndicator.style.display = 'none';
        }
    }

    // 获取模拟智能体数据
    getMockAgents() {
        return [
            {
                id: 1,
                name: '业务咨询助手',
                description: '专门处理业务相关咨询和问题解答的智能助手，能够理解复杂的业务场景并提供专业建议。',
                type: 'business',
                status: 'active',
                tags: ['咨询', '业务', 'FAQ'],
                usage_count: 1250,
                success_rate: 0.94,
                avg_response_time: 2.3,
                created_at: '2024-01-15T10:00:00Z',
                updated_at: '2024-01-20T15:30:00Z',
                creator: 'admin'
            },
            {
                id: 2,
                name: '客户服务机器人',
                description: '7×24小时在线客服机器人，能够处理常见客户问题，转接人工客服，记录客户反馈。',
                type: 'assistant',
                status: 'active',
                tags: ['客服', '自动化', '24/7'],
                usage_count: 3420,
                success_rate: 0.89,
                avg_response_time: 1.8,
                created_at: '2024-01-16T14:20:00Z',
                updated_at: '2024-01-19T09:15:00Z',
                creator: 'support'
            },
            {
                id: 3,
                name: '数据分析专家',
                description: '基于大数据的智能分析助手，能够进行数据挖掘、趋势分析和预测建模。',
                type: 'analyzer',
                status: 'inactive',
                tags: ['分析', '预测', '数据'],
                usage_count: 856,
                success_rate: 0.92,
                avg_response_time: 4.1,
                created_at: '2024-01-17T11:45:00Z',
                updated_at: '2024-01-18T16:20:00Z',
                creator: 'analyst'
            },
            {
                id: 4,
                name: '内容创作助手',
                description: '帮助用户生成高质量的文案、文章和营销内容，支持多种风格和语调。',
                type: 'custom',
                status: 'draft',
                tags: ['创作', '文案', '营销'],
                usage_count: 234,
                success_rate: 0.87,
                avg_response_time: 3.2,
                created_at: '2024-01-18T09:30:00Z',
                updated_at: '2024-01-20T13:45:00Z',
                creator: 'content'
            },
            {
                id: 5,
                name: '技术支持专家',
                description: '专门处理技术问题的智能助手，包括故障诊断、解决方案推荐和技术指导。',
                type: 'assistant',
                status: 'active',
                tags: ['技术', '支持', '诊断'],
                usage_count: 1870,
                success_rate: 0.91,
                avg_response_time: 2.7,
                created_at: '2024-01-19T16:15:00Z',
                updated_at: '2024-01-20T10:00:00Z',
                creator: 'tech'
            },
            {
                id: 6,
                name: '销售顾问机器人',
                description: '智能销售助手，能够进行客户需求分析、产品推荐和销售跟进。',
                type: 'business',
                status: 'active',
                tags: ['销售', '推荐', '跟进'],
                usage_count: 2150,
                success_rate: 0.88,
                avg_response_time: 2.1,
                created_at: '2024-01-20T08:00:00Z',
                updated_at: '2024-01-20T18:30:00Z',
                creator: 'sales'
            }
        ];
    }

    // 渲染智能体列表
    renderAgents() {
        const container = document.getElementById('agentContainer');
        if (!container) return;

        // 更新视图模式类名
        container.className = this.viewMode === 'grid' ? 'agent-grid' : 'agent-list';

        if (this.filteredAgents.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-robot"></i>
                    <h3>暂无智能体</h3>
                    <p>开始创建您的第一个智能助手吧</p>
                    <button class="btn btn-primary" onclick="agentManagement.showCreateAgentModal()">
                        <i class="fas fa-plus"></i> 创建智能体
                    </button>
                </div>
            `;
            return;
        }

        container.innerHTML = this.filteredAgents.map(agent => `
            <div class="agent-card ${this.selectedAgents.has(agent.id) ? 'selected' : ''}" data-agent-id="${agent.id}">
                <input type="checkbox" class="agent-checkbox" value="${agent.id}" ${this.selectedAgents.has(agent.id) ? 'checked' : ''}>
                
                <div class="agent-status">
                    <span class="status-dot ${agent.status}"></span>
                    <span style="font-size: 12px; color: #666;">${this.getStatusText(agent.status)}</span>
                </div>
                
                <div class="agent-card-header">
                    <div class="agent-avatar ${agent.type}">
                        ${this.getAgentIcon(agent.type)}
                    </div>
                    <div class="agent-info">
                        <h3>${agent.name}</h3>
                        <p>${this.getTypeText(agent.type)}</p>
                    </div>
                </div>
                
                <div class="agent-description">
                    ${agent.description}
                </div>
                
                ${agent.tags && agent.tags.length > 0 ? `
                    <div class="agent-tags">
                        ${agent.tags.map(tag => `<span class="agent-tag">${tag}</span>`).join('')}
                    </div>
                ` : ''}
                
                <div class="agent-stats">
                    <div class="agent-stat">
                        <span class="agent-stat-value">${agent.usage_count || 0}</span>
                        <span class="agent-stat-label">使用次数</span>
                    </div>
                    <div class="agent-stat">
                        <span class="agent-stat-value">${Math.round((agent.success_rate || 0) * 100)}%</span>
                        <span class="agent-stat-label">成功率</span>
                    </div>
                    <div class="agent-stat">
                        <span class="agent-stat-value">${agent.avg_response_time || 0}s</span>
                        <span class="agent-stat-label">响应时间</span>
                    </div>
                </div>
                
                <div class="agent-actions">
                    <button class="btn btn-sm btn-primary" onclick="agentManagement.testAgent('${agent.id}')">
                        <i class="fas fa-play"></i> 测试
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="agentManagement.editAgent('${agent.id}')">
                        <i class="fas fa-edit"></i> 编辑
                    </button>
                    <button class="btn btn-sm btn-outline-secondary" onclick="agentManagement.viewAgent('${agent.id}')">
                        <i class="fas fa-eye"></i> 查看
                    </button>
                    <button class="btn btn-sm ${agent.status === 'active' ? 'btn-warning' : 'btn-success'}" onclick="agentManagement.toggleAgentStatus('${agent.id}')">
                        <i class="fas fa-${agent.status === 'active' ? 'pause' : 'play'}"></i> ${agent.status === 'active' ? '停用' : '启用'}
                    </button>
                </div>
            </div>
        `).join('');

        // 更新选择状态
        this.updateSelectionUI();
    }

    // 获取智能体图标
    getAgentIcon(type) {
        const iconMap = {
            'business': '💼',
            'assistant': '🤖',
            'analyzer': '📊',
            'custom': '⚡'
        };
        return iconMap[type] || '🤖';
    }

    // 获取状态文本
    getStatusText(status) {
        const statusMap = {
            'active': '运行中',
            'inactive': '已停用',
            'draft': '草稿'
        };
        return statusMap[status] || status;
    }

    // 获取类型文本
    getTypeText(type) {
        const typeMap = {
            'business': '业务助手',
            'assistant': '通用助手',
            'analyzer': '分析专家',
            'custom': '自定义'
        };
        return typeMap[type] || type;
    }

    // 处理搜索
    handleSearch(query) {
        // 更新查询条件
        this.pagination.terms = this.pagination.terms.filter(term => 
            term.column !== 'name' && term.column !== 'description'
        );
        
        if (query.trim()) {
            // 添加搜索条件 - 在名称、描述中搜索
            this.pagination.terms.push(
                PaginationUtils.createTerm('name', query, 'like')
            );
        }
        
        // 重置到第一页
        this.pagination.pageIndex = 0;
        this.loadAgents().then(() => this.renderAgents());
    }

    // 处理筛选
    handleFilter() {
        const statusFilter = document.getElementById('statusFilter').value;
        const typeFilter = document.getElementById('typeFilter').value;
        
        // 清除现有的状态和类型筛选条件
        this.pagination.terms = this.pagination.terms.filter(term => 
            term.column !== 'status' && term.column !== 'type'
        );
        
        // 添加新的筛选条件
        if (statusFilter) {
            this.pagination.terms.push(
                PaginationUtils.createTerm('status', statusFilter, 'eq')
            );
        }
        
        if (typeFilter) {
            this.pagination.terms.push(
                PaginationUtils.createTerm('type', typeFilter, 'eq')
            );
        }
        
        // 重置到第一页
        this.pagination.pageIndex = 0;
        this.loadAgents().then(() => this.renderAgents());
    }

    // 切换视图模式
    switchView(mode) {
        this.viewMode = mode;
        
        // 更新按钮状态
        document.getElementById('gridView').classList.toggle('active', mode === 'grid');
        document.getElementById('listView').classList.toggle('active', mode === 'list');
        
        // 重新渲染
        this.renderAgents();
    }

    // 处理智能体选择
    handleAgentSelection(checkbox) {
        const agentId = parseInt(checkbox.value);
        const card = checkbox.closest('.agent-card');
        
        if (checkbox.checked) {
            this.selectedAgents.add(agentId);
            card?.classList.add('selected');
        } else {
            this.selectedAgents.delete(agentId);
            card?.classList.remove('selected');
        }
        
        this.updateSelectionUI();
    }

    // 更新选择UI状态
    updateSelectionUI() {
        const selectedCount = this.selectedAgents.size;
        const batchBtn = document.getElementById('batchBtn');
        const bulkActions = document.getElementById('bulkActions');
        const selectedCountSpan = document.getElementById('selectedCount');
        
        // 更新批量操作按钮
        if (batchBtn) {
            batchBtn.disabled = selectedCount === 0;
            batchBtn.textContent = selectedCount > 0 ? `批量操作 (${selectedCount})` : '批量操作';
        }
        
        // 更新批量操作面板
        if (bulkActions && selectedCountSpan) {
            if (selectedCount > 0) {
                bulkActions.classList.add('show');
                selectedCountSpan.textContent = `已选择 ${selectedCount} 个智能体`;
            } else {
                bulkActions.classList.remove('show');
            }
        }
    }

    // 全选
    selectAll() {
        this.filteredAgents.forEach(agent => {
            this.selectedAgents.add(agent.id);
        });
        
        // 更新复选框状态
        document.querySelectorAll('.agent-checkbox').forEach(checkbox => {
            checkbox.checked = true;
            checkbox.closest('.agent-card')?.classList.add('selected');
        });
        
        this.updateSelectionUI();
        Utils.showToast('已选择所有智能体', 'info');
    }

    // 清除选择
    clearSelection() {
        this.selectedAgents.clear();
        
        // 更新复选框状态
        document.querySelectorAll('.agent-checkbox').forEach(checkbox => {
            checkbox.checked = false;
            checkbox.closest('.agent-card')?.classList.remove('selected');
        });
        
        this.updateSelectionUI();
    }

    // 刷新数据
    async refreshData() {
        Utils.showLoading();
        try {
            this.selectedAgents.clear(); // 刷新时清除选择
            await this.loadAgents();
            this.renderAgents();
            Utils.showToast('数据刷新成功', 'success');
        } catch (error) {
            Utils.showToast('刷新失败: ' + error.message, 'error');
        } finally {
            Utils.hideLoading();
        }
    }

    // 显示新建智能体模态框
    showCreateAgentModal() {
        console.log('显示新建智能体模态框');
        Utils.showToast('新建智能体功能开发中', 'info');
    }

    // 测试智能体
    testAgent(agentId) {
        const agent = this.findAgentById(agentId);
        console.log('测试智能体:', agent);
        Utils.showToast(`正在启动智能体"${agent?.name}"的测试环境`, 'info');
    }

    // 查看智能体详情
    viewAgent(agentId) {
        const agent = this.findAgentById(agentId);
        console.log('查看智能体:', agent);
        Utils.showToast('智能体详情页面开发中', 'info');
    }

    // 编辑智能体
    editAgent(agentId) {
        const agent = this.findAgentById(agentId);
        console.log('编辑智能体:', agent);
        Utils.showToast('智能体编辑功能开发中', 'info');
    }

    // 切换智能体状态
    async toggleAgentStatus(agentId) {
        const agent = this.findAgentById(agentId);
        if (!agent) {
            Utils.showToast('智能体不存在', 'error');
            return;
        }
        
        try {
            Utils.showLoading();
            
            const newStatus = agent.status === 'active' ? 'inactive' : 'active';
            console.log('切换智能体状态:', agentId, newStatus);
            
            // 模拟状态切换成功
            setTimeout(() => {
                agent.status = newStatus;
                this.renderAgents();
                Utils.hideLoading();
                Utils.showToast(`智能体已${newStatus === 'active' ? '启用' : '停用'}`, 'success');
            }, 500);
            
        } catch (error) {
            Utils.hideLoading();
            Utils.showToast('操作失败: ' + error.message, 'error');
        }
    }

    // 切换批量操作面板
    toggleBulkActions() {
        if (this.selectedAgents.size === 0) {
            Utils.showToast('请先选择要操作的智能体', 'warning');
            return;
        }
        
        // 批量操作面板已经通过updateSelectionUI自动显示/隐藏
        console.log('当前选中的智能体:', Array.from(this.selectedAgents));
    }

    // 批量切换状态
    async bulkToggleStatus() {
        if (this.selectedAgents.size === 0) return;
        
        const selectedAgentsList = Array.from(this.selectedAgents).map(id => this.findAgentById(id)).filter(Boolean);
        const activeCount = selectedAgentsList.filter(agent => agent.status === 'active').length;
        const inactiveCount = selectedAgentsList.length - activeCount;
        
        let action = 'toggle';
        if (activeCount > inactiveCount) {
            action = 'deactivate';
        } else {
            action = 'activate';
        }
        
        const actionText = action === 'activate' ? '启用' : (action === 'deactivate' ? '停用' : '切换状态');
        
        if (!confirm(`确定要${actionText}选中的 ${this.selectedAgents.size} 个智能体吗？`)) {
            return;
        }
        
        try {
            Utils.showLoading();
            
            console.log(`批量${actionText}智能体:`, Array.from(this.selectedAgents));
            
            // 模拟批量操作成功
            setTimeout(() => {
                selectedAgentsList.forEach(agent => {
                    if (action === 'activate') {
                        agent.status = 'active';
                    } else if (action === 'deactivate') {
                        agent.status = 'inactive';
                    } else {
                        agent.status = agent.status === 'active' ? 'inactive' : 'active';
                    }
                });
                
                this.clearSelection();
                this.renderAgents();
                Utils.hideLoading();
                Utils.showToast(`成功${actionText} ${selectedAgentsList.length} 个智能体`, 'success');
            }, 1000);
            
        } catch (error) {
            Utils.hideLoading();
            Utils.showToast(`批量${actionText}失败: ` + error.message, 'error');
        }
    }

    // 批量删除
    async bulkDelete() {
        if (this.selectedAgents.size === 0) return;
        
        if (!confirm(`确定要删除选中的 ${this.selectedAgents.size} 个智能体吗？此操作不可恢复。`)) {
            return;
        }
        
        try {
            Utils.showLoading();
            
            console.log('批量删除智能体:', Array.from(this.selectedAgents));
            
            // 模拟批量删除成功
            setTimeout(() => {
                Utils.hideLoading();
                Utils.showToast(`成功删除 ${this.selectedAgents.size} 个智能体`, 'success');
                this.clearSelection();
                this.refreshData();
            }, 1000);
            
        } catch (error) {
            Utils.hideLoading();
            Utils.showToast('批量删除失败: ' + error.message, 'error');
        }
    }

    // 根据ID查找智能体
    findAgentById(agentId) {
        return this.agents.find(agent => agent.id == agentId) || this.filteredAgents.find(agent => agent.id == agentId);
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    window.agentManagement = new AgentManagement();
});