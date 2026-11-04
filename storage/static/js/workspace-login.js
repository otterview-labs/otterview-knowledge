'use strict';
const message = {
    credentials: '账号或密码不正确，请重试。',
    rate: '尝试次数过多，请等 5 分钟后再试。',
}[new URLSearchParams(location.search).get('error')];
if (typeof message === 'string') {
    const error = document.getElementById('login-error');
    error.textContent = message;
    error.hidden = false;
}
