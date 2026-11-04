// 认证相关功能
class Auth {
    constructor() {
        this.initEventListeners();
    }

    // 初始化事件监听器
    initEventListeners() {
        // 标签页切换
        const tabButtons = document.querySelectorAll('.tab-button');
        tabButtons.forEach(button => {
            button.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
        });

        // 表单提交
        const loginForm = document.getElementById('loginForm');
        const registerForm = document.getElementById('registerForm');

        if (loginForm) {
            loginForm.addEventListener('submit', (e) => this.handleLogin(e));
        }

        if (registerForm) {
            registerForm.addEventListener('submit', (e) => this.handleRegister(e));
        }

        // 回车键登录
        document.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const activeTab = document.querySelector('.tab-content.active');
                if (activeTab && activeTab.id === 'loginForm') {
                    this.handleLogin(e);
                } else if (activeTab && activeTab.id === 'registerForm') {
                    this.handleRegister(e);
                }
            }
        });
    }

    // 切换标签页
    switchTab(tabName) {
        // 移除所有激活状态
        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

        // 激活选中的标签页
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        document.getElementById(`${tabName}Form`).classList.add('active');
    }

    // 处理登录
    async handleLogin(e) {
        e.preventDefault();

        const formData = new FormData(e.target);
        const username = formData.get('username');
        const password = formData.get('password');
        const rememberMe = formData.get('rememberMe') === 'on';

        // 表单验证
        if (!username) {
            Utils.showToast('请输入用户名或邮箱', 'warning');
            return;
        }

        if (!password) {
            Utils.showToast('请输入密码', 'warning');
            return;
        }

        try {
            Utils.showLoading();

            // 调用登录API
            const response = await Utils.request('/api/v1/auth/login', {
                method: 'POST',
                body: JSON.stringify({
                    username,
                    password,
                    remember_me: rememberMe
                })
            });

            // 登录成功
            Utils.saveUserInfo(response);
            Utils.showToast('登录成功', 'success');
            
            // 跳转到主页
            setTimeout(() => {
                window.location.href = '/static/dashboard.html';
            }, 1500);

        } catch (error) {
            Utils.showToast(error.message || '登录失败，请检查用户名和密码', 'error');
        } finally {
            Utils.hideLoading();
        }
    }

    // 处理注册
    async handleRegister(e) {
        e.preventDefault();

        const formData = new FormData(e.target);
        const username = formData.get('username');
        const email = formData.get('email');
        const fullName = formData.get('fullName');
        const password = formData.get('password');
        const confirmPassword = formData.get('confirmPassword');

        // 表单验证
        if (!username) {
            Utils.showToast('请输入用户名', 'warning');
            return;
        }

        if (!email) {
            Utils.showToast('请输入邮箱', 'warning');
            return;
        }

        if (!Utils.isValidEmail(email)) {
            Utils.showToast('请输入有效的邮箱地址', 'warning');
            return;
        }

        if (!fullName) {
            Utils.showToast('请输入真实姓名', 'warning');
            return;
        }

        const passwordValidation = Utils.validatePassword(password);
        if (!passwordValidation.valid) {
            Utils.showToast(passwordValidation.message, 'warning');
            return;
        }

        if (password !== confirmPassword) {
            Utils.showToast('两次输入的密码不一致', 'warning');
            return;
        }

        try {
            Utils.showLoading();

            // 调用注册API
            const response = await Utils.request('/api/v1/auth/register', {
                method: 'POST',
                body: JSON.stringify({
                    username,
                    email,
                    full_name: fullName,
                    password
                })
            });

            Utils.showToast('注册成功，请登录', 'success');
            
            // 切换到登录标签页
            setTimeout(() => {
                this.switchTab('login');
            }, 1500);

        } catch (error) {
            Utils.showToast(error.message || '注册失败，请重试', 'error');
        } finally {
            Utils.hideLoading();
        }
    }

    // 忘记密码
    async handleForgotPassword() {
        const email = prompt('请输入您的邮箱地址：');
        if (!email) return;

        if (!Utils.isValidEmail(email)) {
            Utils.showToast('请输入有效的邮箱地址', 'warning');
            return;
        }

        try {
            Utils.showLoading();

            await Utils.request('/api/v1/auth/forgot-password', {
                method: 'POST',
                body: JSON.stringify({ email })
            });

            Utils.showToast('密码重置邮件已发送到您的邮箱', 'success');

        } catch (error) {
            Utils.showToast(error.message || '发送失败，请重试', 'error');
        } finally {
            Utils.hideLoading();
        }
    }

    // 检查登录状态
    checkAuthStatus() {
        if (Utils.isLoggedIn()) {
            // 如果已登录，跳转到主页
            window.location.href = '/static/dashboard.html';
        }
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    const auth = new Auth();
    
    // 检查是否已登录
    auth.checkAuthStatus();

    // 绑定忘记密码链接
    const forgotPasswordLink = document.querySelector('.forgot-password');
    if (forgotPasswordLink) {
        forgotPasswordLink.addEventListener('click', (e) => {
            e.preventDefault();
            auth.handleForgotPassword();
        });
    }
});

// 导出认证类
window.Auth = Auth;