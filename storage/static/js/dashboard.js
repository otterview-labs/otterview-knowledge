// 仪表板应用管理 - 生产版本 (已清理模拟数据)
class Dashboard {
    constructor() {
        this.apps = [];
        this.filteredApps = [];
        this.currentFilter = 'all';
        this.searchQuery = '';
        this.init();
    }

    // 初始化
    async init() {
        this.checkAuth();
        this.initEventListeners();
        await this.loadApps();
        this.renderApps();
        this.updateUserInfo();
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
        // 搜索功能
        const searchInput = document.querySelector('.search-box input');
        if (searchInput) {
            searchInput.addEventListener('input', Utils.debounce((e) => {
                this.searchQuery = e.target.value;
                this.filterApps();
            }, 300));
        }

        // 筛选器
        const filterSelects = document.querySelectorAll('.filter-select');
        filterSelects.forEach(select => {
            select.addEventListener('change', (e) => {
                this.currentFilter = e.target.value;
                this.filterApps();
            });
        });

        // 新建应用按钮
        const createAppBtn = document.getElementById('createAppBtn');
        if (createAppBtn) {
            createAppBtn.addEventListener('click', () => this.showCreateAppModal());
        }

        // 用户菜单
        const userMenu = document.querySelector('.user-menu');
        if (userMenu) {
            userMenu.addEventListener('click', () => this.toggleUserMenu());
        }

        // 侧边栏切换（移动端）
        const sidebarToggle = document.getElementById('sidebarToggle');
        if (sidebarToggle) {
            sidebarToggle.addEventListener('click', () => this.toggleSidebar());
        }
    }

    // 更新用户信息显示
    updateUserInfo() {
        const userInfo = Utils.getUserInfo();
        if (userInfo) {
            const userAvatar = document.querySelector('.user-avatar');
            const userName = document.querySelector('.user-name');
            
            if (userAvatar) {
                userAvatar.textContent = userInfo.full_name ? userInfo.full_name.charAt(0).toUpperCase() : 'U';
            }
            
            if (userName) {
                userName.textContent = userInfo.full_name || userInfo.username;
            }
        }
    }

    // 加载应用列表
    async loadApps() {
        try {
            Utils.showLoading();
            
            const response = await Utils.request('/api/v1/applications');
            this.apps = response.data || [];
            this.filteredApps = [...this.apps];
            
            // 如果没有应用数据，显示空状态
            if (this.apps.length === 0) {
                console.log('暂无应用数据，显示空状态界面');
            }
            
        } catch (error) {
            Utils.showToast('加载应用列表失败，请检查网络连接', 'error');
            console.error('加载应用失败:', error);
            
            // 显示错误状态
            this.apps = [];
            this.filteredApps = [];
            this.renderErrorState();
        } finally {
            Utils.hideLoading();
        }
    }

    // 渲染错误状态
    renderErrorState() {
        const appGrid = document.querySelector('.app-grid');
        if (!appGrid) return;
        
        appGrid.innerHTML = `
            <div class="error-state">
                <div class="error-icon">
                    <i class="fas fa-exclamation-triangle"></i>
                </div>
                <div class="error-content">
                    <h3>加载失败</h3>
                    <p>无法连接到服务器，请检查网络连接后重试</p>
                    <button class="btn btn-primary" onclick="location.reload()">
                        <i class="fas fa-refresh"></i>
                        重新加载
                    </button>
                </div>
            </div>
        `;
    }

    // 筛选应用
    filterApps() {
        let filtered = [...this.apps];

        // 按状态筛选
        if (this.currentFilter !== 'all') {
            filtered = filtered.filter(app => app.status === this.currentFilter);
        }

        // 按搜索关键词筛选
        if (this.searchQuery) {
            const query = this.searchQuery.toLowerCase();
            filtered = filtered.filter(app => 
                app.name.toLowerCase().includes(query) ||
                app.description.toLowerCase().includes(query)
            );
        }

        this.filteredApps = filtered;
        this.renderApps();
    }

    // 渲染应用列表
    renderApps() {
        const appGrid = document.querySelector('.app-grid');
        if (!appGrid) return;

        if (this.filteredApps.length === 0) {
            appGrid.innerHTML = this.renderEmptyState();
            return;
        }

        appGrid.innerHTML = this.filteredApps.map(app => this.renderAppCard(app)).join('');
        
        // 绑定应用卡片事件
        this.bindAppCardEvents();
    }

    // 渲染单个应用卡片
    renderAppCard(app) {
        const statusText = this.getStatusText(app.status);
        const statusClass = this.getStatusClass(app.status);
        
        // 获取应用图标
        const icon = this.getAppIcon(app);
        
        return `
            <div class="app-card" data-app-id="${app.id}">
                <div class="app-card-header">
                    <div class="app-card-icon">
                        <i class="${icon}"></i>
                    </div>
                    <div class="app-status ${statusClass}">${statusText}</div>
                </div>
                <div class="app-card-body">
                    <h3 class="app-title">${app.name}</h3>
                    <p class="app-description">${app.description}</p>
                    <div class="app-meta">
                        <div class="app-stats">
                            <div class="app-stat">
                                <i class="fas fa-users"></i>
                                <span>${app.stats?.users || 0}</span>
                            </div>
                            <div class="app-stat">
                                <i class="fas fa-comments"></i>
                                <span>${app.stats?.conversations || 0}</span>
                            </div>
                        </div>
                        <div class="app-date">
                            ${Utils.formatDate(app.created_at, 'MM-DD')}
                        </div>
                    </div>
                </div>
                <div class="app-card-actions">
                    <button class="btn btn-sm btn-outline-primary" onclick="dashboard.openApp(${app.id})">
                        <i class="fas fa-external-link-alt"></i>
                        打开
                    </button>
                    <div class="dropdown">
                        <button class="btn btn-sm btn-outline-secondary dropdown-toggle" 
                                data-bs-toggle="dropdown">
                            <i class="fas fa-ellipsis-h"></i>
                        </button>
                        <ul class="dropdown-menu">
                            <li><a class="dropdown-item" href="#" onclick="dashboard.editApp(${app.id})">
                                <i class="fas fa-edit"></i> 编辑
                            </a></li>
                            <li><a class="dropdown-item" href="#" onclick="dashboard.cloneApp(${app.id})">
                                <i class="fas fa-copy"></i> 复制
                            </a></li>
                            <li><hr class="dropdown-divider"></li>
                            <li><a class="dropdown-item text-danger" href="#" onclick="dashboard.deleteApp(${app.id})">
                                <i class="fas fa-trash"></i> 删除
                            </a></li>
                        </ul>
                    </div>
                </div>
            </div>
        `;
    }

    // 渲染空状态
    renderEmptyState() {
        return `
            <div class="empty-state">
                <div class="empty-icon">
                    <i class="fas fa-plus-circle"></i>
                </div>
                <div class="empty-content">
                    <h3>暂无应用</h3>
                    <p>您还没有创建任何应用，点击下方按钮创建您的第一个应用</p>
                    <button class="btn btn-primary" onclick="dashboard.showCreateAppModal()">
                        <i class="fas fa-plus"></i>
                        创建应用
                    </button>
                </div>
            </div>
        `;
    }

    // 获取状态文本
    getStatusText(status) {
        const statusMap = {
            'published': '已发布',
            'developing': '开发中',
            'testing': '测试中',
            'draft': '草稿',
            'archived': '已归档'
        };
        return statusMap[status] || '未知';
    }

    // 获取状态样式类
    getStatusClass(status) {
        const classMap = {
            'published': 'status-published',
            'developing': 'status-developing', 
            'testing': 'status-testing',
            'draft': 'status-draft',
            'archived': 'status-archived'
        };
        return classMap[status] || 'status-unknown';
    }

    // 获取应用图标
    getAppIcon(app) {
        if (app.icon) return app.icon;
        
        const typeIconMap = {
            'chatbot': 'fas fa-robot',
            'analysis': 'fas fa-chart-bar',
            'automation': 'fas fa-cog',
            'search': 'fas fa-search',
            'custom': 'fas fa-puzzle-piece'
        };
        return typeIconMap[app.type] || 'fas fa-star';
    }

    // 应用操作方法
    openApp(appId) {
        const app = this.apps.find(a => a.id === appId);
        if (app && app.url) {
            window.open(app.url, '_blank');
        }
    }

    editApp(appId) {
        // 编辑应用逻辑
        console.log('编辑应用:', appId);
        Utils.showToast('编辑功能开发中', 'info');
    }

    cloneApp(appId) {
        // 克隆应用逻辑
        console.log('克隆应用:', appId);
        Utils.showToast('克隆功能开发中', 'info');
    }

    async deleteApp(appId) {
        if (!confirm('确定要删除这个应用吗？此操作不可撤销。')) {
            return;
        }

        try {
            await Utils.request(`/api/v1/applications/${appId}`, {
                method: 'DELETE'
            });
            
            // 从本地列表中移除
            this.apps = this.apps.filter(app => app.id !== appId);
            this.filterApps();
            
            Utils.showToast('应用已删除', 'success');
        } catch (error) {
            Utils.showToast('删除应用失败', 'error');
            console.error('删除应用失败:', error);
        }
    }

    showCreateAppModal() {
        // 显示创建应用模态框
        Utils.showToast('创建应用功能开发中', 'info');
    }

    // 绑定应用卡片事件
    bindAppCardEvents() {
        // 应用卡片点击事件等
        const appCards = document.querySelectorAll('.app-card');
        appCards.forEach(card => {
            card.addEventListener('click', (e) => {
                // 如果点击的是操作按钮，不触发卡片点击
                if (e.target.closest('.app-card-actions')) {
                    return;
                }
                
                const appId = parseInt(card.dataset.appId);
                this.openApp(appId);
            });
        });
    }

    // 切换用户菜单
    toggleUserMenu() {
        const userDropdown = document.querySelector('.user-dropdown');
        if (userDropdown) {
            userDropdown.classList.toggle('show');
        }
    }

    // 切换侧边栏
    toggleSidebar() {
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) {
            sidebar.classList.toggle('collapsed');
        }
    }

    // 退出登录
    async logout() {
        try {
            await Utils.request('/api/v1/auth/logout', { method: 'POST' });
        } catch (error) {
            console.error('退出登录失败:', error);
        } finally {
            Utils.clearAuth();
            Utils.navigate('/static/login.html');
        }
    }
}

// 初始化仪表板
let dashboard;
document.addEventListener('DOMContentLoaded', () => {
    dashboard = new Dashboard();
});

// 导出全局访问
window.dashboard = dashboard;