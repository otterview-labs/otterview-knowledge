/**
 * 通用分页工具类
 * 支持标准分页格式的请求和响应处理
 */
class PaginationUtils {
    
    /**
     * 创建标准分页请求
     * @param {number} pageIndex 页索引，从0开始
     * @param {number} pageSize 每页数量
     * @param {Array} sorts 排序条件数组
     * @param {Array} terms 查询条件数组
     * @returns {Object} 标准分页请求对象
     */
    static createPageRequest(pageIndex = 0, pageSize = 12, sorts = [], terms = []) {
        return {
            pageIndex: pageIndex,
            pageSize: pageSize,
            sorts: sorts,
            terms: terms
        };
    }
    
    /**
     * 创建排序条件
     * @param {string} name 排序字段名
     * @param {string} order 排序方向 'asc' | 'desc'
     * @param {string} value 排序值（可选）
     * @returns {Object} 排序条件对象
     */
    static createSort(name, order = 'desc', value = null) {
        const sort = { name, order };
        if (value !== null) {
            sort.value = value;
        }
        return sort;
    }
    
    /**
     * 创建查询条件
     * @param {string} column 字段名
     * @param {any} value 值
     * @param {string} termType 查询类型：eq, like, gt, gte, lt, lte, in, not
     * @returns {Object} 查询条件对象
     */
    static createTerm(column, value, termType = 'eq') {
        return {
            column,
            value,
            termType
        };
    }
    
    /**
     * 发送分页请求
     * @param {string} url API端点URL
     * @param {Object} pageRequest 分页请求对象
     * @param {Object} options 额外的请求选项
     * @returns {Promise<Object>} API响应
     */
    static async fetchPage(url, pageRequest, options = {}) {
        const requestOptions = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
                ...options.headers
            },
            body: JSON.stringify(pageRequest),
            ...options
        };
        
        const response = await fetch(url, requestOptions);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        return await response.json();
    }
}

/**
 * 分页组件类
 * 提供分页UI组件的创建和管理
 */
class PaginationComponent {
    constructor(container, options = {}) {
        this.container = typeof container === 'string' ? document.querySelector(container) : container;
        this.options = {
            pageSize: 12,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: true,
            pageSizeOptions: [10, 12, 20, 50, 100],
            className: 'pagination-wrapper',
            ...options
        };
        
        this.currentPage = 0;
        this.total = 0;
        this.pageSize = this.options.pageSize;
        this.onPageChange = options.onPageChange || (() => {});
        this.onPageSizeChange = options.onPageSizeChange || (() => {});
        
        this.init();
    }
    
    init() {
        this.render();
        this.bindEvents();
    }
    
    /**
     * 渲染分页组件
     */
    render() {
        if (!this.container) return;
        
        const totalPages = Math.ceil(this.total / this.pageSize);
        const startRecord = this.total === 0 ? 0 : this.currentPage * this.pageSize + 1;
        const endRecord = Math.min((this.currentPage + 1) * this.pageSize, this.total);
        
        this.container.innerHTML = `
            <div class="${this.options.className}">
                ${this.options.showTotal ? `
                    <div class="pagination-info">
                        显示第 ${startRecord}-${endRecord} 条记录，共 ${this.total} 条
                    </div>
                ` : ''}
                
                <div class="pagination-controls">
                    <button class="pagination-btn pagination-prev" ${this.currentPage === 0 ? 'disabled' : ''}>
                        <i class="fas fa-chevron-left"></i> 上一页
                    </button>
                    
                    <div class="pagination-pages">
                        ${this.renderPageNumbers(totalPages)}
                    </div>
                    
                    <button class="pagination-btn pagination-next" ${this.currentPage >= totalPages - 1 ? 'disabled' : ''}>
                        下一页 <i class="fas fa-chevron-right"></i>
                    </button>
                </div>
                
                ${this.options.showSizeChanger ? `
                    <div class="pagination-size-changer">
                        <label>每页显示</label>
                        <select class="pagination-size-select">
                            ${this.options.pageSizeOptions.map(size => 
                                `<option value="${size}" ${size === this.pageSize ? 'selected' : ''}>${size}</option>`
                            ).join('')}
                        </select>
                        <label>条</label>
                    </div>
                ` : ''}
                
                ${this.options.showQuickJumper ? `
                    <div class="pagination-jumper">
                        <label>跳至</label>
                        <input type="number" class="pagination-jump-input" min="1" max="${totalPages}" placeholder="页码">
                        <button class="pagination-jump-btn">确定</button>
                    </div>
                ` : ''}
            </div>
        `;
    }
    
    /**
     * 渲染页码按钮
     */
    renderPageNumbers(totalPages) {
        if (totalPages <= 1) return '';
        
        const pages = [];
        const current = this.currentPage;
        
        // 始终显示第一页
        if (totalPages > 0) {
            pages.push(0);
        }
        
        // 计算显示范围
        let start = Math.max(1, current - 2);
        let end = Math.min(totalPages - 1, current + 2);
        
        // 调整范围以显示更多页码
        if (current - 2 <= 1) {
            end = Math.min(totalPages - 1, 5);
        }
        if (current + 2 >= totalPages - 1) {
            start = Math.max(1, totalPages - 6);
        }
        
        // 添加省略号和中间页码
        if (start > 1) {
            pages.push('...');
        }
        
        for (let i = start; i <= end; i++) {
            if (i > 0 && i < totalPages - 1) {
                pages.push(i);
            }
        }
        
        if (end < totalPages - 1) {
            pages.push('...');
        }
        
        // 始终显示最后一页（如果不是第一页）
        if (totalPages > 1) {
            pages.push(totalPages - 1);
        }
        
        return pages.map(page => {
            if (page === '...') {
                return '<span class="pagination-ellipsis">...</span>';
            }
            
            const isActive = page === current;
            return `<button class="pagination-page ${isActive ? 'active' : ''}" data-page="${page}">${page + 1}</button>`;
        }).join('');
    }
    
    /**
     * 绑定事件
     */
    bindEvents() {
        if (!this.container) return;
        
        // 分页按钮点击
        this.container.addEventListener('click', (e) => {
            const target = e.target;
            
            // 上一页
            if (target.classList.contains('pagination-prev') && !target.disabled) {
                this.goToPage(this.currentPage - 1);
            }
            
            // 下一页  
            if (target.classList.contains('pagination-next') && !target.disabled) {
                this.goToPage(this.currentPage + 1);
            }
            
            // 页码按钮
            if (target.classList.contains('pagination-page')) {
                const page = parseInt(target.dataset.page);
                this.goToPage(page);
            }
            
            // 跳转按钮
            if (target.classList.contains('pagination-jump-btn')) {
                const input = this.container.querySelector('.pagination-jump-input');
                const page = parseInt(input.value) - 1; // 转换为0基索引
                if (page >= 0 && page < Math.ceil(this.total / this.pageSize)) {
                    this.goToPage(page);
                    input.value = '';
                }
            }
        });
        
        // 页面大小改变
        const sizeSelect = this.container.querySelector('.pagination-size-select');
        if (sizeSelect) {
            sizeSelect.addEventListener('change', (e) => {
                const newSize = parseInt(e.target.value);
                this.changePageSize(newSize);
            });
        }
        
        // 跳转输入框回车
        const jumpInput = this.container.querySelector('.pagination-jump-input');
        if (jumpInput) {
            jumpInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const page = parseInt(e.target.value) - 1;
                    if (page >= 0 && page < Math.ceil(this.total / this.pageSize)) {
                        this.goToPage(page);
                        e.target.value = '';
                    }
                }
            });
        }
    }
    
    /**
     * 跳转到指定页
     */
    goToPage(page) {
        const totalPages = Math.ceil(this.total / this.pageSize);
        if (page >= 0 && page < totalPages && page !== this.currentPage) {
            this.currentPage = page;
            this.render();
            this.onPageChange(page, this.pageSize);
        }
    }
    
    /**
     * 改变页面大小
     */
    changePageSize(newSize) {
        if (newSize !== this.pageSize) {
            this.pageSize = newSize;
            this.currentPage = 0; // 重置到第一页
            this.render();
            this.onPageSizeChange(this.currentPage, newSize);
        }
    }
    
    /**
     * 更新分页数据
     */
    update(currentPage, total, pageSize) {
        this.currentPage = currentPage;
        this.total = total;
        this.pageSize = pageSize;
        this.render();
    }
    
    /**
     * 获取当前分页状态
     */
    getState() {
        return {
            currentPage: this.currentPage,
            pageSize: this.pageSize,
            total: this.total,
            totalPages: Math.ceil(this.total / this.pageSize)
        };
    }
}

// 导出到全局
window.PaginationUtils = PaginationUtils;
window.PaginationComponent = PaginationComponent;