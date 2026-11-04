// 用户管理类
class UserManagement {
    constructor() {
        this.users = [];
        this.filteredUsers = [];
        this.isLoading = false;
        
        // 分页相关
        this.pagination = {
            pageIndex: 0,
            pageSize: 12,
            total: 0,
            sorts: [
                { name: 'created_at', order: 'desc' }
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
        
        await this.loadUsers();
        this.renderUsers();
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

        // 角色筛选
        const roleFilter = document.getElementById('roleFilter');
        if (roleFilter) {
            roleFilter.addEventListener('change', () => this.handleFilter());
        }

        // 刷新按钮
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.refreshData());
        }

        // 新建用户按钮
        const createUserBtn = document.getElementById('createUserBtn');
        if (createUserBtn) {
            createUserBtn.addEventListener('click', () => this.showCreateUserModal());
        }

        // 批量操作按钮
        const batchBtn = document.getElementById('batchBtn');
        if (batchBtn) {
            batchBtn.addEventListener('click', () => this.showBatchActions());
        }

        // 全选/取消全选
        const selectAll = document.getElementById('selectAll');
        if (selectAll) {
            selectAll.addEventListener('change', () => this.toggleSelectAll());
        }

        // 监听复选框变化
        document.addEventListener('change', (e) => {
            if (e.target.classList.contains('user-checkbox')) {
                this.updateBatchButtonState();
            }
        });
    }

    // 初始化分页组件
    initPagination() {
        const paginationContainer = document.querySelector('#user-pagination');
        if (paginationContainer) {
            this.paginationComponent = new PaginationComponent(paginationContainer, {
                pageSize: this.pagination.pageSize,
                onPageChange: (pageIndex, pageSize) => {
                    this.pagination.pageIndex = pageIndex;
                    this.pagination.pageSize = pageSize;
                    this.loadUsers();
                },
                onPageSizeChange: (pageIndex, pageSize) => {
                    this.pagination.pageIndex = pageIndex;
                    this.pagination.pageSize = pageSize;
                    this.loadUsers();
                }
            });
        }
    }

    // 初始化键盘快捷键
    initKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd + N: 新建用户
            if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
                e.preventDefault();
                this.showCreateUserModal();
            }
            
            // F5 / Ctrl/Cmd + R: 刷新
            if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key === 'r')) {
                e.preventDefault();
                this.refreshData();
            }
            
            // Delete: 删除选中用户
            if (e.key === 'Delete') {
                const selected = document.querySelectorAll('.user-checkbox:checked');
                if (selected.length > 0) {
                    e.preventDefault();
                    this.batchDelete(Array.from(selected).map(cb => cb.value));
                }
            }
        });
    }

    // 加载用户列表
    async loadUsers() {
        if (this.isLoading) return;
        
        this.isLoading = true;
        const loadingIndicator = document.querySelector('#user-loading');
        
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
            
            console.log('用户管理: 分页请求 =', pageRequest);
            
            // 尝试使用新的分页API
            try {
                const response = await PaginationUtils.fetchPage('/api/v1/user/list', pageRequest);
                
                if (response.status === 200 && response.result) {
                    this.users = response.result.data || [];
                    this.pagination.total = response.result.total || 0;
                    this.filteredUsers = [...this.users];
                    
                    console.log('用户管理: 新API加载成功, 用户数量 =', this.users.length);
                } else {
                    throw new Error('新API响应格式错误');
                }
            } catch (error) {
                console.error('用户管理: API调用失败:', error.message);
                Utils.showToast('无法连接到服务器，请检查网络连接', 'error');
                this.renderErrorState();
                return;
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
            console.error('用户管理: 加载用户失败:', error);
            Utils.showToast('加载用户失败: ' + error.message, 'error');
            this.renderErrorState();
            
        } finally {
            this.isLoading = false;
            if (loadingIndicator) loadingIndicator.style.display = 'none';
        }
    }

    // 渲染错误状态
    renderErrorState() {
        const tableBody = document.getElementById('userTableBody');
        if (!tableBody) return;
        
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="error-state">
                    <div class="error-content">
                        <i class="fas fa-exclamation-triangle"></i>
                        <h3>加载失败</h3>
                        <p>无法连接到服务器，请检查网络连接后重试</p>
                        <button class="btn btn-primary" onclick="userManagement.refreshData()">
                            <i class="fas fa-refresh"></i>
                            重新加载
                        </button>
                    </div>
                </td>
            </tr>
        `;
        
        // 重置分页组件
        if (this.paginationComponent) {
            this.paginationComponent.update(0, 0, this.pagination.pageSize);
        }
    }

    // 渲染用户列表
    renderUsers() {
        const tableBody = document.getElementById('userTableBody');
        if (!tableBody) return;

        if (this.filteredUsers.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="empty-state">
                        <i class="fas fa-users"></i>
                        <p>暂无用户数据</p>
                        <p style="font-size: 14px; color: #999;">请检查筛选条件或添加新用户</p>
                    </td>
                </tr>
            `;
            return;
        }

        tableBody.innerHTML = this.filteredUsers.map(user => `
            <tr>
                <td>
                    <input type="checkbox" class="user-checkbox" value="${user.id}">
                </td>
                <td>
                    <div class="user-info">
                        <div class="user-avatar">
                            ${this.getUserInitials(user.full_name || user.username)}
                        </div>
                        <div class="user-details">
                            <h4>${user.full_name || user.username}</h4>
                            <p>${user.email}</p>
                        </div>
                    </div>
                </td>
                <td>
                    <span class="role-badge ${user.role}">
                        ${this.getRoleText(user.role)}
                    </span>
                </td>
                <td>
                    <span class="status-badge ${user.is_active ? 'active' : 'inactive'}">
                        ${user.is_active ? '启用' : '禁用'}
                    </span>
                </td>
                <td>${this.formatDate(user.created_at)}</td>
                <td>${this.formatDate(user.last_login)}</td>
                <td>
                    <div class="action-btns">
                        <button class="btn-icon" onclick="userManagement.viewUser('${user.id}')" title="查看">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="btn-icon" onclick="userManagement.editUser('${user.id}')" title="编辑">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-icon" onclick="userManagement.toggleUserStatus('${user.id}')" title="${user.is_active ? '禁用' : '启用'}">
                            <i class="fas fa-${user.is_active ? 'ban' : 'check'}"></i>
                        </button>
                        <button class="btn-icon" onclick="userManagement.deleteUser('${user.id}')" title="删除">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    // 处理搜索
    handleSearch(query) {
        // 更新查询条件
        this.pagination.terms = this.pagination.terms.filter(term => 
            term.column !== 'username' && term.column !== 'email' && term.column !== 'full_name'
        );
        
        if (query.trim()) {
            // 添加搜索条件 - 在用户名、邮箱、全名中搜索
            this.pagination.terms.push(
                PaginationUtils.createTerm('username', query, 'like')
            );
        }
        
        // 重置到第一页
        this.pagination.pageIndex = 0;
        this.loadUsers().then(() => this.renderUsers());
    }

    // 处理筛选
    handleFilter() {
        const statusFilter = document.getElementById('statusFilter').value;
        const roleFilter = document.getElementById('roleFilter').value;
        
        // 清除现有的状态和角色筛选条件
        this.pagination.terms = this.pagination.terms.filter(term => 
            term.column !== 'is_active' && term.column !== 'role'
        );
        
        // 添加新的筛选条件
        if (statusFilter) {
            this.pagination.terms.push(
                PaginationUtils.createTerm('is_active', statusFilter === 'active', 'eq')
            );
        }
        
        if (roleFilter) {
            this.pagination.terms.push(
                PaginationUtils.createTerm('role', roleFilter, 'eq')
            );
        }
        
        // 重置到第一页
        this.pagination.pageIndex = 0;
        this.loadUsers().then(() => this.renderUsers());
    }

    // 获取用户姓名首字母
    getUserInitials(name) {
        if (!name) return '?';
        const words = name.split(' ');
        if (words.length >= 2) {
            return (words[0][0] + words[1][0]).toUpperCase();
        }
        return name.substring(0, 2).toUpperCase();
    }

    // 获取角色文本
    getRoleText(role) {
        const roleMap = {
            'admin': '管理员',
            'user': '普通用户'
        };
        return roleMap[role] || role;
    }

    // 格式化日期
    formatDate(dateString) {
        if (!dateString) return '--';
        const date = new Date(dateString);
        return date.toLocaleDateString('zh-CN') + ' ' + date.toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    // 刷新数据
    async refreshData() {
        Utils.showLoading();
        try {
            await this.loadUsers();
            this.renderUsers();
            Utils.showToast('数据刷新成功', 'success');
        } catch (error) {
            Utils.showToast('刷新失败: ' + error.message, 'error');
        } finally {
            Utils.hideLoading();
        }
    }

    // 切换全选状态
    toggleSelectAll() {
        const selectAll = document.getElementById('selectAll');
        const checkboxes = document.querySelectorAll('.user-checkbox');
        
        checkboxes.forEach(checkbox => {
            checkbox.checked = selectAll.checked;
        });
        
        this.updateBatchButtonState();
    }

    // 更新批量操作按钮状态
    updateBatchButtonState() {
        const checkboxes = document.querySelectorAll('.user-checkbox:checked');
        const batchBtn = document.getElementById('batchBtn');
        
        if (batchBtn) {
            batchBtn.disabled = checkboxes.length === 0;
            batchBtn.textContent = checkboxes.length > 0 
                ? `批量操作 (${checkboxes.length})` 
                : '批量操作';
        }
    }

    // 显示新建用户模态框
    showCreateUserModal() {
        const modal = document.createElement('div');
        modal.className = 'upload-modal';
        modal.innerHTML = `
            <div class="upload-modal-content">
                <div class="modal-header">
                    <h3 class="modal-title">新建用户</h3>
                    <button class="modal-close" onclick="this.parentElement.parentElement.parentElement.remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="form-group">
                    <label>用户名</label>
                    <input type="text" class="form-control" id="newUsername" placeholder="请输入用户名" required>
                </div>
                
                <div class="form-group">
                    <label>邮箱</label>
                    <input type="email" class="form-control" id="newEmail" placeholder="请输入邮箱地址" required>
                </div>
                
                <div class="form-group">
                    <label>全名</label>
                    <input type="text" class="form-control" id="newFullName" placeholder="请输入全名">
                </div>
                
                <div class="form-group">
                    <label>角色</label>
                    <select class="form-control" id="newRole" required>
                        <option value="user">普通用户</option>
                        <option value="admin">管理员</option>
                    </select>
                </div>
                
                <div class="form-group">
                    <label>密码</label>
                    <input type="password" class="form-control" id="newPassword" placeholder="请输入密码" required>
                </div>
                
                <div class="form-group">
                    <label>
                        <input type="checkbox" id="newIsActive" checked> 启用用户
                    </label>
                </div>
                
                <div class="modal-actions">
                    <button class="btn btn-secondary" onclick="this.parentElement.parentElement.parentElement.remove()">取消</button>
                    <button class="btn btn-primary" onclick="userManagement.createUser()">创建</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }

    // 创建用户
    async createUser() {
        const username = document.getElementById('newUsername').value.trim();
        const email = document.getElementById('newEmail').value.trim();
        const fullName = document.getElementById('newFullName').value.trim();
        const role = document.getElementById('newRole').value;
        const password = document.getElementById('newPassword').value.trim();
        const isActive = document.getElementById('newIsActive').checked;
        
        if (!username || !email || !password) {
            Utils.showToast('请填写必填字段', 'warning');
            return;
        }
        
        try {
            Utils.showLoading();
            
            // 调用创建用户API
            const userData = {
                username,
                email,
                full_name: fullName,
                role,
                password,
                is_active: isActive
            };
            
            const response = await Utils.request('/api/v1/user/create', {
                method: 'POST',
                body: JSON.stringify(userData)
            });
            
            if (response.status === 201) {
                Utils.showToast('用户创建成功', 'success');
                document.querySelector('.upload-modal').remove();
                await this.refreshData();
            } else {
                throw new Error(response.message || '创建用户失败');
            }
            
        } catch (error) {
            Utils.hideLoading();
            Utils.showToast('创建失败: ' + error.message, 'error');
        }
    }

    // 查看用户详情
    viewUser(userId) {
        const user = this.users.find(u => u.id == userId) || this.filteredUsers.find(u => u.id == userId);
        if (!user) {
            Utils.showToast('用户不存在', 'error');
            return;
        }
        
        // TODO: 实现用户详情查看功能
        console.log('查看用户:', user);
        Utils.showToast('用户详情功能开发中', 'info');
    }

    // 编辑用户
    editUser(userId) {
        const user = this.users.find(u => u.id == userId) || this.filteredUsers.find(u => u.id == userId);
        if (!user) {
            Utils.showToast('用户不存在', 'error');
            return;
        }
        
        // TODO: 实现用户编辑功能
        console.log('编辑用户:', user);
        Utils.showToast('用户编辑功能开发中', 'info');
    }

    // 切换用户状态
    async toggleUserStatus(userId) {
        const user = this.users.find(u => u.id == userId) || this.filteredUsers.find(u => u.id == userId);
        if (!user) {
            Utils.showToast('用户不存在', 'error');
            return;
        }
        
        try {
            Utils.showLoading();
            
            // 调用切换状态API
            const action = user.is_active ? 'deactivate' : 'activate';
            const response = await Utils.request(`/api/v1/user/${action}`, {
                method: 'POST',
                body: JSON.stringify({ user_id: userId })
            });
            
            if (response.status === 200) {
                Utils.showToast(`用户已${user.is_active ? '禁用' : '启用'}`, 'success');
                await this.refreshData();
            } else {
                throw new Error(response.message || '状态切换失败');
            }
            
        } catch (error) {
            Utils.hideLoading();
            Utils.showToast('操作失败: ' + error.message, 'error');
        }
    }

    // 删除用户
    async deleteUser(userId) {
        const user = this.users.find(u => u.id == userId) || this.filteredUsers.find(u => u.id == userId);
        if (!user) {
            Utils.showToast('用户不存在', 'error');
            return;
        }
        
        if (!confirm(`确定要删除用户"${user.full_name || user.username}"吗？此操作不可恢复。`)) {
            return;
        }
        
        try {
            Utils.showLoading();
            
            // 调用删除用户API
            const response = await Utils.request(`/api/v1/user/delete`, {
                method: 'POST',
                body: JSON.stringify({ user_id: userId })
            });
            
            if (response.status === 200) {
                Utils.showToast('用户删除成功', 'success');
                await this.refreshData();
            } else {
                throw new Error(response.message || '删除用户失败');
            }
            
        } catch (error) {
            Utils.hideLoading();
            Utils.showToast('删除失败: ' + error.message, 'error');
        }
    }

    // 显示批量操作菜单
    showBatchActions() {
        const checkboxes = document.querySelectorAll('.user-checkbox:checked');
        const selectedIds = Array.from(checkboxes).map(cb => cb.value);
        
        if (selectedIds.length === 0) {
            Utils.showToast('请选择要操作的用户', 'warning');
            return;
        }
        
        // TODO: 实现批量操作功能
        console.log('批量操作用户:', selectedIds);
        Utils.showToast('批量操作功能开发中', 'info');
    }

    // 批量删除用户
    async batchDelete(userIds) {
        if (!userIds || userIds.length === 0) return;
        
        if (!confirm(`确定要删除选中的 ${userIds.length} 个用户吗？此操作不可恢复。`)) {
            return;
        }
        
        try {
            Utils.showLoading();
            
            // 调用批量删除API
            const response = await Utils.request('/api/v1/user/batch-delete', {
                method: 'POST',
                body: JSON.stringify({ user_ids: userIds })
            });
            
            if (response.status === 200) {
                Utils.showToast(`成功删除 ${userIds.length} 个用户`, 'success');
                await this.refreshData();
            } else {
                throw new Error(response.message || '批量删除失败');
            }
            
        } catch (error) {
            Utils.hideLoading();
            Utils.showToast('批量删除失败: ' + error.message, 'error');
        }
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    window.userManagement = new UserManagement();
});