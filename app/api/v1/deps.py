#!/usr/bin/env python
# -*- coding:utf-8 -*-
"""
API依赖项
"""
from typing import Generator, Optional
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
import jwt
from jwt import InvalidTokenError as JWTError
from sqlalchemy.orm import Session
from app.config import settings
from app.db.session import SessionLocal

# 尝试导入User模型，如果失败则创建一个简单的User类
try:
    from app.db.models import User
except ImportError:
    # 如果User模型不存在，创建一个简单的类
    class User:
        def __init__(self, id=None, username=None, email=None, full_name=None, is_active=True, is_superuser=False):
            self.id = id
            self.username = username
            self.email = email
            self.full_name = full_name
            self.is_active = is_active
            self.is_superuser = is_superuser

# OAuth2 密码承载者
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/user/login", auto_error=False)

def get_db() -> Generator:
    """获取数据库会话"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def is_auth_enforced() -> bool:
    """判断当前运行模式是否必须执行认证。"""

    if settings.is_production:
        return True
    return not (settings.SKIP_AUTH and settings.DEV_MODE)


def _authenticate_user(
    db: Session,
    token: Optional[str],
    *,
    allow_missing: bool = False,
    return_none_on_invalid: bool = False,
):
    """解析 token 并返回用户对象。"""

    if not token:
        if allow_missing:
            return None
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未提供认证token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = jwt.decode(token, settings.security.SECRET_KEY, algorithms=[settings.security.ALGORITHM], options={"require": ["exp"]})
        user_id: int = payload.get("user_id")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="无效的token格式",
                headers={"WWW-Authenticate": "Bearer"},
            )
    except JWTError:
        if return_none_on_invalid:
            return None
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="token验证失败",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        if return_none_on_invalid:
            return None
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户不存在",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        if return_none_on_invalid:
            return None
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户账户已禁用",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user


def _authenticate_user_with_new_session(
    token: Optional[str],
    *,
    allow_missing: bool = False,
    return_none_on_invalid: bool = False,
):
    """使用独立数据库会话解析 token，避免额外路由依赖。"""

    db = SessionLocal()
    try:
        return _authenticate_user(
            db,
            token,
            allow_missing=allow_missing,
            return_none_on_invalid=return_none_on_invalid,
        )
    finally:
        db.close()

def get_current_user(  
    db: Session = Depends(get_db), 
    token: Optional[str] = Depends(oauth2_scheme)
):
    """获取当前用户"""

    return _authenticate_user(db, token)

def get_current_active_user(  # 暂时注释掉用户认证功能
    current_user = Depends(get_current_user),
):
    """获取当前活跃用户"""
    if not current_user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user

def get_current_active_superuser(  # 暂时注释掉用户认证功能
    current_user = Depends(get_current_user),
):
    """获取当前超级用户"""
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=400, detail="The user doesn't have enough privileges"
        )
    return current_user

def get_optional_current_user(
    db: Session = Depends(get_db), 
    token: Optional[str] = Depends(oauth2_scheme)
):
    """获取可选的当前用户（可能返回None）"""

    return _authenticate_user(
        db,
        token,
        allow_missing=True,
        return_none_on_invalid=True,
    )


def get_request_user(
    token: Optional[str] = Depends(oauth2_scheme),
    request: Request = None,
):
    """写操作统一使用的用户依赖。生产环境强制认证。"""

    account = getattr(request.state, "workspace_account", None) if request is not None else None
    if account is not None:
        return account

    if not is_auth_enforced():
        return None
    return _authenticate_user_with_new_session(token)


def get_optional_request_user(
    token: Optional[str] = Depends(oauth2_scheme),
    request: Request = None,
):
    """读操作统一使用的用户依赖。生产环境允许匿名，但非法 token 会失败。"""

    account = getattr(request.state, "workspace_account", None) if request is not None else None
    if account is not None:
        return account

    if not is_auth_enforced():
        return None
    return _authenticate_user_with_new_session(token, allow_missing=True)


def get_compat_request_user(
    token: Optional[str] = Depends(oauth2_scheme),
    request: Request = None,
):
    """旧接口与标准接口使用相同认证边界。"""
    return get_request_user(token, request)


def get_runtime_admin(current_user=Depends(get_request_user)):
    """尚未实现逐资源授权的管理能力只向管理员开放。"""
    if is_auth_enforced() and not getattr(current_user, "is_superuser", False):
        raise HTTPException(status_code=403, detail="此操作需要运行时管理员权限")
    return current_user


def require_runtime_access(request: Request, current_user=Depends(get_request_user)):
    """检索使用文档权限；其余管理路由在完成资源授权前只允许管理员。"""
    path = request.url.path.rstrip("/")
    user_routes = {"/api/v1/rag/search/unified"}
    if path in user_routes or path.startswith(("/api/v1/rag/search/methods", "/api/v1/llm/")):
        return current_user
    return get_runtime_admin(current_user)
