// 通用工具函数
class Utils {
    // 显示加载状态
    static showLoading() {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.classList.remove('hidden');
        }
    }

    // 隐藏加载状态
    static hideLoading() {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.classList.add('hidden');
        }
    }

    // 显示消息提示
    static showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer') || document.body;
        
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <div style="display: flex; align-items: center;">
                <i class="fas fa-${this.getToastIcon(type)}" style="margin-right: 12px;"></i>
                <span>${message}</span>
                <button onclick="this.parentElement.parentElement.remove()" 
                        style="background: none; border: none; margin-left: auto; cursor: pointer; font-size: 18px;">&times;</button>
            </div>
        `;

        container.appendChild(toast);

        // 自动移除
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 5000);
    }

    // 获取提示图标
    static getToastIcon(type) {
        const icons = {
            success: 'check-circle',
            error: 'exclamation-circle',
            warning: 'exclamation-triangle',
            info: 'info-circle'
        };
        return icons[type] || 'info-circle';
    }

    // API请求封装
    static async request(url, options = {}) {
        const defaultOptions = {
            ...options
        };

        // 如果不是FormData，则设置JSON Content-Type
        if (!(options.body instanceof FormData)) {
            defaultOptions.headers = {
                'Content-Type': 'application/json',
                ...options.headers
            };
        } else {
            // 对于FormData，让浏览器自动设置Content-Type
            defaultOptions.headers = {
                ...options.headers
            };
        }

        // 添加认证token
        const token = localStorage.getItem('authToken');
        if (token) {
            defaultOptions.headers['Authorization'] = `Bearer ${token}`;
        }

        try {
            const response = await fetch(url, defaultOptions);
            
            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: '请求失败' }));
                throw new Error(error.message || `HTTP ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('API请求错误:', error);
            throw error;
        }
    }

    // 格式化日期
    static formatDate(date, format = 'YYYY-MM-DD HH:mm:ss') {
        if (!date) return '';
        
        const d = new Date(date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hour = String(d.getHours()).padStart(2, '0');
        const minute = String(d.getMinutes()).padStart(2, '0');
        const second = String(d.getSeconds()).padStart(2, '0');

        return format
            .replace('YYYY', year)
            .replace('MM', month)
            .replace('DD', day)
            .replace('HH', hour)
            .replace('mm', minute)
            .replace('ss', second);
    }

    // 验证邮箱格式
    static isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    // 验证密码强度
    static validatePassword(password) {
        if (!password) return { valid: false, message: '请输入密码' };
        if (password.length < 6) return { valid: false, message: '密码至少6位' };
        if (password.length > 20) return { valid: false, message: '密码不能超过20位' };
        
        return { valid: true };
    }

    // 防抖函数
    static debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // 节流函数
    static throttle(func, limit) {
        let inThrottle;
        return function() {
            const args = arguments;
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    // 获取用户信息
    static getUserInfo() {
        const userInfo = localStorage.getItem('userInfo');
        return userInfo ? JSON.parse(userInfo) : null;
    }

    // 保存用户信息
    static saveUserInfo(userInfo) {
        localStorage.setItem('userInfo', JSON.stringify(userInfo));
        localStorage.setItem('authToken', userInfo.access_token || userInfo.token);
    }

    // 清除用户信息
    static clearUserInfo() {
        localStorage.removeItem('userInfo');
        localStorage.removeItem('authToken');
    }

    // 检查是否已登录
    static isLoggedIn() {
        return !!localStorage.getItem('authToken');
    }

    // 退出登录
    static logout() {
        this.clearUserInfo();
        window.location.href = '/static/login.html';
    }

    // 页面跳转
    static navigate(url) {
        window.location.href = url;
    }
}

// 全局错误处理
window.addEventListener('error', function(e) {
    console.error('全局错误:', e.error);
    Utils.showToast('系统错误，请刷新页面重试', 'error');
});

// 全局未捕获的Promise错误处理
window.addEventListener('unhandledrejection', function(e) {
    console.error('未捕获的Promise错误:', e.reason);
    Utils.showToast('网络请求失败，请重试', 'error');
});

// 导出工具类
window.Utils = Utils;