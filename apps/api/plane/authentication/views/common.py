# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.shortcuts import render

# Third party imports
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from zxcvbn import zxcvbn

## Module imports
from plane.app.serializers import UserSerializer
from plane.authentication.utils.login import user_login
from plane.db.models import User
from plane.authentication.adapter.error import (
    AuthenticationException,
    AUTHENTICATION_ERROR_CODES,
)
from django.middleware.csrf import get_token
from plane.utils.cache import invalidate_cache
from plane.authentication.utils.host import base_host


class CSRFTokenEndpoint(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        # Generate a CSRF token
        csrf_token = get_token(request)
        # Return the CSRF token in a JSON response
        return Response({"csrf_token": str(csrf_token)}, status=status.HTTP_200_OK)


def csrf_failure(request, reason=""):
    """Custom CSRF failure view

    ARRIBADA FIX: `status=403`. This called `render()` with no status, so a
    request Django had just REFUSED was answered **200 OK** — the page said
    something went wrong and the status line said it had not. Every caller that
    judges by the status code, which is every programmatic one, was told the
    write succeeded.

    Found while writing an OAuth consent test that asserted 403 and failed
    against a guard working perfectly, which is the dangerous direction: the
    obvious response is to go looking for why CSRF "is not enforced".

    Fork drift, one line, in an upstream file. Nothing here changes WHETHER a
    request is refused — only what the refusal says about itself. The rendered
    page is unchanged, so a browser shows exactly what it showed before.
    """
    return render(
        request,
        "csrf_failure.html",
        {"reason": reason, "root_url": base_host(request=request)},
        status=403,
    )


class ChangePasswordEndpoint(APIView):
    def post(self, request):
        user = User.objects.get(pk=request.user.id)

        # If the user password is not autoset then we need to check the old passwords
        if not user.is_password_autoset:
            old_password = request.data.get("old_password", False)
            if not old_password:
                exc = AuthenticationException(
                    error_code=AUTHENTICATION_ERROR_CODES["MISSING_PASSWORD"],
                    error_message="MISSING_PASSWORD",
                    payload={"error": "Old password is missing"},
                )
                return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        # Get the new password
        new_password = request.data.get("new_password", False)

        if not new_password:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["MISSING_PASSWORD"],
                error_message="MISSING_PASSWORD",
                payload={"error": "Old or new password is missing"},
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        # If the user password is not autoset then we need to check the old passwords
        if not user.is_password_autoset and not user.check_password(old_password):
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INCORRECT_OLD_PASSWORD"],
                error_message="INCORRECT_OLD_PASSWORD",
                payload={"error": "Old password is not correct"},
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        # check the password score
        results = zxcvbn(new_password)
        if results["score"] < 3:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["PASSWORD_TOO_WEAK"],
                error_message="PASSWORD_TOO_WEAK",
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        # set_password also hashes the password that the user will get
        user.set_password(new_password)
        user.is_password_autoset = False
        user.save()
        user_login(user=user, request=request, is_app=True)
        return Response({"message": "Password updated successfully"}, status=status.HTTP_200_OK)


class SetUserPasswordEndpoint(APIView):
    @invalidate_cache("/api/users/me/")
    def post(self, request):
        user = User.objects.get(pk=request.user.id)
        password = request.data.get("password", False)

        # If the user password is not autoset then return error
        if not user.is_password_autoset:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["PASSWORD_ALREADY_SET"],
                error_message="PASSWORD_ALREADY_SET",
                payload={"error": "Your password is already set please change your password from profile"},
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        # Check password validation
        if not password:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INVALID_PASSWORD"],
                error_message="INVALID_PASSWORD",
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        results = zxcvbn(password)
        if results["score"] < 3:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INVALID_PASSWORD"],
                error_message="INVALID_PASSWORD",
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        # Set the user password
        user.set_password(password)
        user.is_password_autoset = False
        user.save()
        # Login the user as the session is invalidated
        user_login(user=user, request=request, is_app=True)
        # Return the user
        serializer = UserSerializer(user)
        return Response(serializer.data, status=status.HTTP_200_OK)
