/* مولَّد آلياً من backend/core/api_contract.json (pnpm --filter @sting/app-core generate) — لا يُحرَّر يدوياً. */

/** كل رموز `detail` التي رُصدت من الخادم (184 رمزاً). */
export const API_ERROR_CODES = [
  "account_exists",
  "ack_dropped",
  "acknowledgement_required",
  "addon_invalid",
  "addon_not_offered",
  "admin_required",
  "alias_taken",
  "all_channels_off",
  "allocation_mismatch",
  "already_cancelled",
  "already_decided",
  "already_in_state",
  "already_invited",
  "already_received",
  "already_referred",
  "already_reviewed",
  "already_suspended",
  "ambiguous_name",
  "amount_mismatch",
  "audience_or_duration_required",
  "audience_out_of_tenant",
  "backup_unusable",
  "bad_registration_secret",
  "bad_transition",
  "below_cost",
  "blocked",
  "branch_forbidden",
  "branch_limit",
  "bulk_pricing_blocked",
  "buyer_is_self",
  "cannot_disable_self",
  "cash_method_required",
  "channel_invalid",
  "channel_without_destination",
  "checklist_incomplete",
  "claimed_by_other",
  "code_exists",
  "code_expired",
  "code_invalid",
  "code_locked",
  "code_required",
  "code_taken",
  "conflict",
  "corrupt",
  "cost_policy_invalid",
  "currency_mismatch",
  "cycle_invalid",
  "days_out_of_range",
  "decisions_pending",
  "default_branch",
  "delete_unavailable",
  "device_active",
  "device_session_required",
  "device_wiped",
  "dispute_closed",
  "document_locked",
  "duplicate",
  "duplicate_receipt",
  "duplicate_reference",
  "email_invalid",
  "email_only",
  "email_required",
  "epoch_mismatch",
  "evidence_required",
  "exceeds_confirmed",
  "exceeds_returnable",
  "exceeds_shipped",
  "factor_required",
  "feature_invalid",
  "fields_missing",
  "finance_required",
  "freeze_reconciliation",
  "group_exists",
  "identifier_invalid",
  "image_expired",
  "image_not_found",
  "image_too_large",
  "import_owner_or_manager",
  "increase_reason_required",
  "invalid_credentials",
  "invalid_current_password",
  "invalid_email",
  "invalid_envelope",
  "invite_expired",
  "invite_is_own",
  "item_not_found",
  "kind_not_revertible",
  "limit_required",
  "limits_exceeded",
  "limits_invalid",
  "line_expired",
  "lines_invalid",
  "link_exists",
  "live_restore_requirements",
  "logo_too_large",
  "manager_required",
  "membership_not_found",
  "membership_suspended",
  "min_order_not_met",
  "network_cut",
  "new_owner_unverified",
  "no_access_in_branch",
  "no_email",
  "no_global_override",
  "not_applied",
  "not_found",
  "not_pending",
  "not_remembered",
  "not_resendable",
  "not_the_new_owner",
  "note_required",
  "nothing_to_cancel",
  "nothing_to_change",
  "notice_too_short",
  "open_shift",
  "operator_required",
  "operator_scope_publish_only",
  "out_of_scope",
  "over_limit",
  "owner_locked",
  "owner_not_revocable",
  "owner_or_manager_required",
  "owner_required",
  "page_invalid",
  "page_not_found",
  "paid_plan_required",
  "password_change_required",
  "password_too_short",
  "password_unchanged",
  "payload_key_not_allowed",
  "permission_denied",
  "phase_locked",
  "phone_invalid",
  "plan_feature_required",
  "plan_invalid",
  "platform_staff_required",
  "pos_core_required",
  "price_changed",
  "price_owner_only",
  "promise_outside_plan",
  "publish_permission_required",
  "publish_suspended",
  "qty_invalid",
  "range_too_wide",
  "reason_required",
  "reasons_required",
  "reconciling",
  "reference_required",
  "reference_used",
  "reject_reason_required",
  "resend_limit",
  "resend_too_soon",
  "retry_after",
  "revert_refused",
  "role_invalid",
  "same_plan",
  "same_reviewer",
  "scope_required",
  "self_role",
  "seller_not_verified",
  "send_failed",
  "sender_required",
  "service_areas_required",
  "session_revoked",
  "shift_open",
  "similar_party",
  "tenant_account",
  "tenant_account_email",
  "tenant_not_found",
  "tenant_only_when_converted",
  "tier_gap",
  "token_invalid",
  "too_wide",
  "trial_not_reassignable",
  "unauthenticated",
  "undo_expired",
  "unit_not_found",
  "unknown_action",
  "user_inactive",
  "user_limit",
  "validation_error",
  "validity_past",
  "version_superseded",
  "whatsapp_invalid",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** الرموز المرصودة لكل عملية مع حالتها: «POST /api/x» ← [{status, code}]. */
export const API_ERRORS_BY_OPERATION: Readonly<
  Record<string, readonly { readonly status: number; readonly code: ApiErrorCode }[]>
> = {
  "GET /api/account/memberships": [
    {
      status: 401,
      code: "unauthenticated",
    },
  ],
  "GET /api/auth/me": [
    {
      status: 401,
      code: "session_revoked",
    },
  ],
  "GET /api/bootstrap/{image_id}/page": [
    {
      status: 400,
      code: "page_invalid",
    },
    {
      status: 404,
      code: "image_not_found",
    },
    {
      status: 404,
      code: "page_not_found",
    },
    {
      status: 410,
      code: "image_expired",
    },
  ],
  "GET /api/campaigns": [
    {
      status: 403,
      code: "permission_denied",
    },
  ],
  "GET /api/catalog/items/{item_id}": [
    {
      status: 404,
      code: "item_not_found",
    },
  ],
  "GET /api/devices/verifiers": [
    {
      status: 403,
      code: "device_session_required",
    },
  ],
  "GET /api/inventory/balances": [
    {
      status: 403,
      code: "branch_forbidden",
    },
  ],
  "GET /api/inventory/items/{item_id}/movements": [
    {
      status: 404,
      code: "not_found",
    },
  ],
  "GET /api/inventory/purchasing/cost-margin": [
    {
      status: 403,
      code: "permission_denied",
    },
  ],
  "GET /api/inventory/purchasing/orders": [
    {
      status: 403,
      code: "permission_denied",
    },
  ],
  "GET /api/inventory/transfers/{transfer_id}": [
    {
      status: 404,
      code: "not_found",
    },
  ],
  "GET /api/invites/{token}": [
    {
      status: 401,
      code: "unauthenticated",
    },
  ],
  "GET /api/market/lists/{list_id}": [
    {
      status: 404,
      code: "not_found",
    },
  ],
  "GET /api/market/offers": [
    {
      status: 403,
      code: "permission_denied",
    },
  ],
  "GET /api/market/offers/public/{offer_id}": [
    {
      status: 404,
      code: "not_found",
    },
  ],
  "GET /api/market/orders/{order_id}": [
    {
      status: 404,
      code: "not_found",
    },
  ],
  "GET /api/market/orders/{order_id}/quote": [
    {
      status: 404,
      code: "not_found",
    },
  ],
  "GET /api/market/orders/{order_id}/receive": [
    {
      status: 404,
      code: "not_found",
    },
  ],
  "GET /api/market/reports/{report_id}": [
    {
      status: 404,
      code: "not_found",
    },
  ],
  "GET /api/org/audit": [
    {
      status: 403,
      code: "owner_required",
    },
  ],
  "GET /api/org/devices": [
    {
      status: 403,
      code: "owner_or_manager_required",
    },
  ],
  "GET /api/org/subscription": [
    {
      status: 403,
      code: "owner_or_manager_required",
    },
  ],
  "GET /api/org/subscription/addon": [
    {
      status: 400,
      code: "addon_invalid",
    },
    {
      status: 400,
      code: "qty_invalid",
    },
    {
      status: 403,
      code: "owner_required",
    },
    {
      status: 409,
      code: "addon_not_offered",
    },
    {
      status: 409,
      code: "paid_plan_required",
    },
  ],
  "GET /api/org/subscription/change": [
    {
      status: 403,
      code: "owner_required",
    },
    {
      status: 409,
      code: "same_plan",
    },
  ],
  "GET /api/org/subscription/receipts": [
    {
      status: 403,
      code: "owner_required",
    },
  ],
  "GET /api/org/users": [
    {
      status: 401,
      code: "user_inactive",
    },
    {
      status: 403,
      code: "owner_or_manager_required",
    },
  ],
  "GET /api/parties/list": [
    {
      status: 403,
      code: "finance_required",
    },
  ],
  "GET /api/parties/{party_id}/merge": [
    {
      status: 403,
      code: "owner_required",
    },
  ],
  "GET /api/parties/{party_id}/statement": [
    {
      status: 403,
      code: "finance_required",
    },
  ],
  "GET /api/platform/demo-requests": [
    {
      status: 403,
      code: "operator_required",
    },
  ],
  "GET /api/platform/operators": [
    {
      status: 401,
      code: "user_inactive",
    },
    {
      status: 403,
      code: "operator_required",
    },
    {
      status: 403,
      code: "password_change_required",
    },
  ],
  "GET /api/platform/outbound": [
    {
      status: 403,
      code: "operator_required",
    },
  ],
  "GET /api/platform/overview": [
    {
      status: 403,
      code: "operator_required",
    },
  ],
  "GET /api/platform/plans": [
    {
      status: 403,
      code: "operator_required",
    },
  ],
  "GET /api/platform/proofs": [
    {
      status: 403,
      code: "operator_required",
    },
  ],
  "GET /api/platform/tenants": [
    {
      status: 403,
      code: "operator_required",
    },
  ],
  "GET /api/portal/{slug}": [
    {
      status: 404,
      code: "not_found",
    },
  ],
  "GET /api/portal/{slug}/messages": [
    {
      status: 404,
      code: "not_found",
    },
  ],
  "GET /api/public/demo-track": [
    {
      status: 401,
      code: "token_invalid",
    },
  ],
  "GET /api/public/market/invite/{token}": [
    {
      status: 410,
      code: "invite_expired",
    },
  ],
  "GET /api/public/market/suppliers/{tenant_id}": [
    {
      status: 404,
      code: "not_found",
    },
  ],
  "GET /api/reports/cash": [
    {
      status: 403,
      code: "permission_denied",
    },
  ],
  "GET /api/reports/export/preview": [
    {
      status: 400,
      code: "range_too_wide",
    },
  ],
  "GET /api/reports/exports": [
    {
      status: 403,
      code: "permission_denied",
    },
  ],
  "GET /api/reports/margin": [
    {
      status: 403,
      code: "permission_denied",
    },
  ],
  "GET /api/reports/receivables": [
    {
      status: 403,
      code: "permission_denied",
    },
  ],
  "GET /api/reports/sales": [
    {
      status: 403,
      code: "permission_denied",
    },
  ],
  "GET /api/reports/stock": [
    {
      status: 403,
      code: "permission_denied",
    },
  ],
  "GET /api/sales": [
    {
      status: 403,
      code: "owner_required",
    },
  ],
  "GET /api/sales/{sale_id}": [
    {
      status: 403,
      code: "out_of_scope",
    },
  ],
  "GET /api/sync/status": [
    {
      status: 401,
      code: "session_revoked",
    },
  ],
  "GET /api/tenants/creation/{client_request_id}": [
    {
      status: 404,
      code: "not_found",
    },
  ],
  "PATCH /api/catalog/items/{item_id}": [
    {
      status: 400,
      code: "validation_error",
    },
  ],
  "PATCH /api/catalog/items/{item_id}/units/{item_unit_id}": [
    {
      status: 400,
      code: "validation_error",
    },
    {
      status: 404,
      code: "unit_not_found",
    },
  ],
  "PATCH /api/inventory/purchasing/documents/{document_id}": [
    {
      status: 400,
      code: "document_locked",
    },
  ],
  "PATCH /api/parties/{party_id}": [
    {
      status: 400,
      code: "validation_error",
    },
    {
      status: 403,
      code: "manager_required",
    },
  ],
  "PATCH /api/tenants/onboarding": [
    {
      status: 413,
      code: "logo_too_large",
    },
  ],
  "POST /api/account/select": [
    {
      status: 401,
      code: "unauthenticated",
    },
    {
      status: 403,
      code: "membership_suspended",
    },
    {
      status: 404,
      code: "membership_not_found",
    },
  ],
  "POST /api/account/sessions/{session_id}/revoke": [
    {
      status: 403,
      code: "permission_denied",
    },
  ],
  "POST /api/auth/account/login": [
    {
      status: 401,
      code: "invalid_credentials",
    },
    {
      status: 429,
      code: "retry_after",
    },
  ],
  "POST /api/auth/account/register": [
    {
      status: 400,
      code: "email_only",
    },
    {
      status: 400,
      code: "phone_invalid",
    },
    {
      status: 409,
      code: "account_exists",
    },
  ],
  "POST /api/auth/login": [
    {
      status: 401,
      code: "invalid_credentials",
    },
  ],
  "POST /api/auth/refresh": [
    {
      status: 401,
      code: "token_invalid",
    },
  ],
  "POST /api/auth/remember": [
    {
      status: 401,
      code: "token_invalid",
    },
  ],
  "POST /api/auth/resume": [
    {
      status: 401,
      code: "not_remembered",
    },
    {
      status: 401,
      code: "token_invalid",
    },
  ],
  "POST /api/auth/verify/confirm": [
    {
      status: 400,
      code: "code_invalid",
    },
    {
      status: 410,
      code: "code_expired",
    },
  ],
  "POST /api/auth/verify/request": [
    {
      status: 400,
      code: "email_only",
    },
    {
      status: 400,
      code: "identifier_invalid",
    },
    {
      status: 429,
      code: "resend_limit",
    },
    {
      status: 429,
      code: "resend_too_soon",
    },
    {
      status: 503,
      code: "send_failed",
    },
  ],
  "POST /api/bootstrap/start": [
    {
      status: 403,
      code: "device_session_required",
    },
  ],
  "POST /api/bootstrap/{image_id}/complete": [
    {
      status: 410,
      code: "image_expired",
    },
  ],
  "POST /api/campaigns/preview": [
    {
      status: 400,
      code: "audience_out_of_tenant",
    },
    {
      status: 403,
      code: "permission_denied",
    },
  ],
  "POST /api/campaigns/{campaign_id}/{action}": [
    {
      status: 400,
      code: "blocked",
    },
    {
      status: 403,
      code: "permission_denied",
    },
  ],
  "POST /api/catalog/groups": [
    {
      status: 409,
      code: "group_exists",
    },
  ],
  "POST /api/catalog/items": [
    {
      status: 400,
      code: "validation_error",
    },
  ],
  "POST /api/catalog/items/{item_id}/aliases": [
    {
      status: 409,
      code: "alias_taken",
    },
  ],
  "POST /api/catalog/items/{item_id}/image": [
    {
      status: 400,
      code: "validation_error",
    },
    {
      status: 413,
      code: "image_too_large",
    },
  ],
  "POST /api/catalog/items/{item_id}/price": [
    {
      status: 400,
      code: "validation_error",
    },
    {
      status: 403,
      code: "price_owner_only",
    },
    {
      status: 409,
      code: "below_cost",
    },
  ],
  "POST /api/catalog/items/{item_id}/units": [
    {
      status: 400,
      code: "validation_error",
    },
  ],
  "POST /api/catalog/prices/import/preview": [
    {
      status: 403,
      code: "bulk_pricing_blocked",
    },
    {
      status: 403,
      code: "price_owner_only",
    },
  ],
  "POST /api/catalog/prices/import/{batch_id}/revert": [
    {
      status: 409,
      code: "revert_refused",
    },
  ],
  "POST /api/devices/renew": [
    {
      status: 401,
      code: "bad_registration_secret",
    },
  ],
  "POST /api/grow/promote": [
    {
      status: 400,
      code: "audience_or_duration_required",
    },
  ],
  "POST /api/grow/replenish": [
    {
      status: 403,
      code: "permission_denied",
    },
    {
      status: 423,
      code: "phase_locked",
    },
  ],
  "POST /api/imports/preview": [
    {
      status: 403,
      code: "import_owner_or_manager",
    },
  ],
  "POST /api/imports/{batch_id}/apply": [
    {
      status: 400,
      code: "decisions_pending",
    },
  ],
  "POST /api/imports/{batch_id}/revert": [
    {
      status: 409,
      code: "kind_not_revertible",
    },
    {
      status: 409,
      code: "not_applied",
    },
  ],
  "POST /api/inventory/count-sessions/{session_id}": [
    {
      status: 400,
      code: "validation_error",
    },
    {
      status: 403,
      code: "finance_required",
    },
  ],
  "POST /api/inventory/items/{item_id}/damage": [
    {
      status: 400,
      code: "validation_error",
    },
    {
      status: 403,
      code: "owner_required",
    },
  ],
  "POST /api/inventory/openings": [
    {
      status: 400,
      code: "validation_error",
    },
  ],
  "POST /api/inventory/openings/{opening_id}/approve": [
    {
      status: 400,
      code: "validation_error",
    },
    {
      status: 403,
      code: "owner_required",
    },
  ],
  "POST /api/inventory/purchasing/documents/{document_id}/{action}": [
    {
      status: 400,
      code: "blocked",
    },
    {
      status: 400,
      code: "lines_invalid",
    },
    {
      status: 403,
      code: "over_limit",
    },
  ],
  "POST /api/inventory/purchasing/orders": [
    {
      status: 400,
      code: "lines_invalid",
    },
    {
      status: 403,
      code: "permission_denied",
    },
  ],
  "POST /api/inventory/purchasing/orders/{order_id}/{action}": [
    {
      status: 400,
      code: "reason_required",
    },
    {
      status: 400,
      code: "send_failed",
    },
  ],
  "POST /api/inventory/transfers/{transfer_id}/cancel": [
    {
      status: 400,
      code: "validation_error",
    },
    {
      status: 403,
      code: "sender_required",
    },
  ],
  "POST /api/market/account/verification/submit": [
    {
      status: 400,
      code: "checklist_incomplete",
    },
  ],
  "POST /api/market/following": [
    {
      status: 403,
      code: "owner_required",
    },
  ],
  "POST /api/market/invite/{token}/accept": [
    {
      status: 400,
      code: "invite_is_own",
    },
  ],
  "POST /api/market/invites": [
    {
      status: 403,
      code: "publish_permission_required",
    },
  ],
  "POST /api/market/link/documents/{link_id}/{action}": [
    {
      status: 400,
      code: "note_required",
    },
    {
      status: 403,
      code: "permission_denied",
    },
  ],
  "POST /api/market/link/incoming/{link_id}/{action}": [
    {
      status: 400,
      code: "already_decided",
    },
  ],
  "POST /api/market/link/items": [
    {
      status: 400,
      code: "factor_required",
    },
    {
      status: 403,
      code: "permission_denied",
    },
  ],
  "POST /api/market/link/parties/{party_id}/{action}": [
    {
      status: 400,
      code: "ambiguous_name",
    },
    {
      status: 400,
      code: "link_exists",
    },
    {
      status: 403,
      code: "permission_denied",
    },
    {
      status: 423,
      code: "phase_locked",
    },
  ],
  "POST /api/market/link/receipts/{shipment_id}/{action}": [
    {
      status: 403,
      code: "permission_denied",
    },
    {
      status: 409,
      code: "duplicate_receipt",
    },
  ],
  "POST /api/market/lists": [
    {
      status: 400,
      code: "tier_gap",
    },
    {
      status: 403,
      code: "publish_permission_required",
    },
  ],
  "POST /api/market/lists/{list_id}/accept": [
    {
      status: 404,
      code: "not_found",
    },
  ],
  "POST /api/market/lists/{list_id}/members": [
    {
      status: 400,
      code: "buyer_is_self",
    },
  ],
  "POST /api/market/offers/{offer_id}/renew": [
    {
      status: 403,
      code: "publish_permission_required",
    },
  ],
  "POST /api/market/offers/{offer_id}/{action}": [
    {
      status: 400,
      code: "fields_missing",
    },
    {
      status: 400,
      code: "note_required",
    },
    {
      status: 400,
      code: "plan_feature_required",
    },
    {
      status: 400,
      code: "publish_suspended",
    },
    {
      status: 400,
      code: "seller_not_verified",
    },
    {
      status: 403,
      code: "publish_permission_required",
    },
  ],
  "POST /api/market/orders": [
    {
      status: 400,
      code: "currency_mismatch",
    },
    {
      status: 400,
      code: "min_order_not_met",
    },
    {
      status: 403,
      code: "permission_denied",
    },
    {
      status: 409,
      code: "line_expired",
    },
    {
      status: 409,
      code: "price_changed",
    },
  ],
  "POST /api/market/orders/{order_id}/accept": [
    {
      status: 400,
      code: "version_superseded",
    },
  ],
  "POST /api/market/orders/{order_id}/cancel-remaining": [
    {
      status: 400,
      code: "already_cancelled",
    },
    {
      status: 400,
      code: "reason_required",
    },
    {
      status: 403,
      code: "permission_denied",
    },
  ],
  "POST /api/market/orders/{order_id}/decline": [
    {
      status: 400,
      code: "reason_required",
    },
  ],
  "POST /api/market/orders/{order_id}/disputes/{dispute_id}/{action}": [
    {
      status: 400,
      code: "dispute_closed",
    },
    {
      status: 403,
      code: "permission_denied",
    },
  ],
  "POST /api/market/orders/{order_id}/payments": [
    {
      status: 400,
      code: "allocation_mismatch",
    },
    {
      status: 400,
      code: "amount_mismatch",
    },
    {
      status: 400,
      code: "reference_used",
    },
  ],
  "POST /api/market/orders/{order_id}/payments/{payment_id}/{action}": [
    {
      status: 400,
      code: "already_decided",
    },
    {
      status: 404,
      code: "not_found",
    },
  ],
  "POST /api/market/orders/{order_id}/quote": [
    {
      status: 400,
      code: "increase_reason_required",
    },
    {
      status: 400,
      code: "validity_past",
    },
  ],
  "POST /api/market/orders/{order_id}/receive": [
    {
      status: 400,
      code: "already_received",
    },
    {
      status: 400,
      code: "exceeds_shipped",
    },
    {
      status: 400,
      code: "reject_reason_required",
    },
  ],
  "POST /api/market/orders/{order_id}/resend": [
    {
      status: 400,
      code: "not_resendable",
    },
  ],
  "POST /api/market/orders/{order_id}/restore": [
    {
      status: 403,
      code: "owner_required",
    },
    {
      status: 404,
      code: "not_found",
    },
  ],
  "POST /api/market/orders/{order_id}/restore/events/{event_id}": [
    {
      status: 400,
      code: "reason_required",
    },
    {
      status: 403,
      code: "owner_required",
    },
  ],
  "POST /api/market/orders/{order_id}/returns": [
    {
      status: 400,
      code: "exceeds_returnable",
    },
    {
      status: 400,
      code: "reason_required",
    },
  ],
  "POST /api/market/orders/{order_id}/returns/{return_id}/decide": [
    {
      status: 400,
      code: "already_decided",
    },
    {
      status: 404,
      code: "not_found",
    },
  ],
  "POST /api/market/orders/{order_id}/shipments": [
    {
      status: 400,
      code: "exceeds_confirmed",
    },
    {
      status: 400,
      code: "reconciling",
    },
    {
      status: 404,
      code: "not_found",
    },
  ],
  "POST /api/market/reports": [
    {
      status: 400,
      code: "evidence_required",
    },
  ],
  "POST /api/notifications/{notification_id}/{action}": [
    {
      status: 403,
      code: "permission_denied",
    },
  ],
  "POST /api/org/branches": [
    {
      status: 400,
      code: "branch_limit",
    },
    {
      status: 400,
      code: "code_invalid",
    },
    {
      status: 400,
      code: "code_taken",
    },
    {
      status: 403,
      code: "owner_required",
    },
  ],
  "POST /api/org/branches/{branch_id}/{action}": [
    {
      status: 400,
      code: "code_locked",
    },
    {
      status: 400,
      code: "default_branch",
    },
    {
      status: 400,
      code: "delete_unavailable",
    },
  ],
  "POST /api/org/invitations": [
    {
      status: 400,
      code: "email_only",
    },
    {
      status: 400,
      code: "identifier_invalid",
    },
    {
      status: 400,
      code: "user_limit",
    },
    {
      status: 409,
      code: "already_invited",
    },
  ],
  "POST /api/org/ownership": [
    {
      status: 400,
      code: "new_owner_unverified",
    },
    {
      status: 403,
      code: "owner_required",
    },
    {
      status: 409,
      code: "conflict",
    },
  ],
  "POST /api/org/ownership/{transfer_id}/{action}": [
    {
      status: 403,
      code: "not_the_new_owner",
    },
  ],
  "POST /api/org/subscription/addon": [
    {
      status: 400,
      code: "qty_invalid",
    },
    {
      status: 409,
      code: "limits_exceeded",
    },
  ],
  "POST /api/org/subscription/change": [
    {
      status: 400,
      code: "nothing_to_cancel",
    },
    {
      status: 409,
      code: "limits_exceeded",
    },
  ],
  "POST /api/org/subscription/proofs": [
    {
      status: 400,
      code: "addon_not_offered",
    },
    {
      status: 400,
      code: "cycle_invalid",
    },
    {
      status: 400,
      code: "limits_exceeded",
    },
    {
      status: 400,
      code: "plan_invalid",
    },
    {
      status: 400,
      code: "reference_required",
    },
    {
      status: 403,
      code: "owner_required",
    },
    {
      status: 409,
      code: "duplicate_reference",
    },
  ],
  "POST /api/org/subscription/proofs/{proof_id}/image": [
    {
      status: 400,
      code: "image_too_large",
    },
  ],
  "POST /api/org/support-access": [
    {
      status: 403,
      code: "owner_required",
    },
  ],
  "POST /api/org/users/{user_id}/revocation": [
    {
      status: 400,
      code: "acknowledgement_required",
    },
    {
      status: 400,
      code: "no_access_in_branch",
    },
    {
      status: 400,
      code: "open_shift",
    },
    {
      status: 400,
      code: "owner_not_revocable",
    },
    {
      status: 403,
      code: "owner_required",
    },
  ],
  "POST /api/parties": [
    {
      status: 400,
      code: "validation_error",
    },
    {
      status: 409,
      code: "similar_party",
    },
  ],
  "POST /api/parties/merges/{merge_id}/undo": [
    {
      status: 400,
      code: "validation_error",
    },
  ],
  "POST /api/parties/receipts/{receipt_id}/correct": [
    {
      status: 400,
      code: "validation_error",
    },
    {
      status: 403,
      code: "owner_required",
    },
  ],
  "POST /api/parties/receipts/{receipt_id}/match": [
    {
      status: 400,
      code: "validation_error",
    },
    {
      status: 403,
      code: "owner_required",
    },
  ],
  "POST /api/parties/{party_id}/merge": [
    {
      status: 400,
      code: "validation_error",
    },
  ],
  "POST /api/parties/{party_id}/opening-balance": [
    {
      status: 400,
      code: "validation_error",
    },
    {
      status: 403,
      code: "owner_required",
    },
  ],
  "POST /api/parties/{party_id}/statement/export": [
    {
      status: 400,
      code: "validation_error",
    },
    {
      status: 403,
      code: "owner_required",
    },
  ],
  "POST /api/platform/announcements/{announcement_id}/{action}": [
    {
      status: 400,
      code: "promise_outside_plan",
    },
  ],
  "POST /api/platform/appeals/{tenant_id}/{offer_id}/decide": [
    {
      status: 409,
      code: "same_reviewer",
    },
  ],
  "POST /api/platform/backups/{backup_id}/{action}": [
    {
      status: 400,
      code: "backup_unusable",
    },
    {
      status: 400,
      code: "live_restore_requirements",
    },
  ],
  "POST /api/platform/demo-requests/{request_id}": [
    {
      status: 400,
      code: "note_required",
    },
    {
      status: 400,
      code: "nothing_to_change",
    },
    {
      status: 404,
      code: "not_found",
    },
    {
      status: 404,
      code: "tenant_not_found",
    },
    {
      status: 409,
      code: "bad_transition",
    },
    {
      status: 409,
      code: "tenant_only_when_converted",
    },
  ],
  "POST /api/platform/disputes/{tenant_id}/{dispute_id}/{action}": [
    {
      status: 400,
      code: "note_required",
    },
    {
      status: 409,
      code: "already_referred",
    },
  ],
  "POST /api/platform/entitlements": [
    {
      status: 400,
      code: "feature_invalid",
    },
    {
      status: 403,
      code: "no_global_override",
    },
  ],
  "POST /api/platform/flags": [
    {
      status: 400,
      code: "scope_required",
    },
    {
      status: 403,
      code: "admin_required",
    },
    {
      status: 403,
      code: "no_global_override",
    },
  ],
  "POST /api/platform/login": [
    {
      status: 400,
      code: "invalid_credentials",
    },
    {
      status: 403,
      code: "tenant_account",
    },
  ],
  "POST /api/platform/me/password": [
    {
      status: 400,
      code: "invalid_current_password",
    },
    {
      status: 400,
      code: "password_unchanged",
    },
  ],
  "POST /api/platform/operators": [
    {
      status: 400,
      code: "invalid_email",
    },
    {
      status: 400,
      code: "password_too_short",
    },
    {
      status: 403,
      code: "admin_required",
    },
    {
      status: 409,
      code: "tenant_account_email",
    },
  ],
  "POST /api/platform/operators/{operator_id}/{action}": [
    {
      status: 400,
      code: "password_too_short",
    },
    {
      status: 400,
      code: "role_invalid",
    },
    {
      status: 400,
      code: "unknown_action",
    },
    {
      status: 403,
      code: "admin_required",
    },
    {
      status: 409,
      code: "already_in_state",
    },
    {
      status: 409,
      code: "cannot_disable_self",
    },
    {
      status: 409,
      code: "self_role",
    },
  ],
  "POST /api/platform/outbound/channels/{key}": [
    {
      status: 400,
      code: "channel_invalid",
    },
  ],
  "POST /api/platform/plans": [
    {
      status: 409,
      code: "code_exists",
    },
  ],
  "POST /api/platform/plans/{code}/{action}": [
    {
      status: 400,
      code: "nothing_to_change",
    },
    {
      status: 400,
      code: "notice_too_short",
    },
    {
      status: 400,
      code: "pos_core_required",
    },
    {
      status: 403,
      code: "admin_required",
    },
  ],
  "POST /api/platform/proofs/{tenant_id}/{proof_id}/{action}": [
    {
      status: 400,
      code: "reason_required",
    },
    {
      status: 400,
      code: "reference_used",
    },
    {
      status: 409,
      code: "already_reviewed",
    },
    {
      status: 409,
      code: "claimed_by_other",
    },
  ],
  "POST /api/platform/reports/{tenant_id}/{report_id}/decide": [
    {
      status: 400,
      code: "reason_required",
    },
    {
      status: 403,
      code: "operator_scope_publish_only",
    },
    {
      status: 409,
      code: "already_decided",
    },
  ],
  "POST /api/platform/tenants/{tenant_id}/market-verification/review": [
    {
      status: 400,
      code: "reasons_required",
    },
  ],
  "POST /api/platform/tenants/{tenant_id}/subscription": [
    {
      status: 400,
      code: "days_out_of_range",
    },
    {
      status: 400,
      code: "limits_invalid",
    },
    {
      status: 400,
      code: "nothing_to_change",
    },
    {
      status: 400,
      code: "reason_required",
    },
    {
      status: 400,
      code: "unknown_action",
    },
    {
      status: 403,
      code: "operator_required",
    },
    {
      status: 409,
      code: "already_suspended",
    },
    {
      status: 409,
      code: "same_plan",
    },
    {
      status: 409,
      code: "trial_not_reassignable",
    },
  ],
  "POST /api/platform/tenants/{tenant_id}/subscription-proofs/{proof_id}/review": [
    {
      status: 400,
      code: "already_reviewed",
    },
    {
      status: 400,
      code: "reason_required",
    },
    {
      status: 403,
      code: "platform_staff_required",
    },
  ],
  "POST /api/platform/verifications/{tenant_id}/{action}": [
    {
      status: 400,
      code: "not_pending",
    },
    {
      status: 400,
      code: "reasons_required",
    },
  ],
  "POST /api/portal/{slug}/messages/{message_id}/read": [
    {
      status: 403,
      code: "permission_denied",
    },
  ],
  "POST /api/portal/{slug}/resubscribe": [
    {
      status: 410,
      code: "undo_expired",
    },
  ],
  "POST /api/portal/{slug}/subscribe": [
    {
      status: 400,
      code: "phone_invalid",
    },
  ],
  "POST /api/public/contact": [
    {
      status: 400,
      code: "code_invalid",
    },
    {
      status: 400,
      code: "code_required",
    },
    {
      status: 409,
      code: "duplicate",
    },
  ],
  "POST /api/public/contact/start": [
    {
      status: 400,
      code: "email_invalid",
    },
    {
      status: 400,
      code: "email_required",
    },
    {
      status: 400,
      code: "whatsapp_invalid",
    },
    {
      status: 409,
      code: "duplicate",
    },
  ],
  "POST /api/public/demo-track/start": [
    {
      status: 404,
      code: "not_found",
    },
    {
      status: 409,
      code: "no_email",
    },
  ],
  "POST /api/public/demo-track/verify": [
    {
      status: 400,
      code: "code_invalid",
    },
  ],
  "POST /api/sales/duplicates/decide": [
    {
      status: 400,
      code: "validation_error",
    },
    {
      status: 403,
      code: "manager_required",
    },
  ],
  "POST /api/shifts/{shift_id}/requests": [
    {
      status: 400,
      code: "validation_error",
    },
  ],
  "POST /api/shifts/{shift_id}/review": [
    {
      status: 400,
      code: "shift_open",
    },
    {
      status: 400,
      code: "validation_error",
    },
    {
      status: 403,
      code: "owner_required",
    },
  ],
  "POST /api/support/backups": [
    {
      status: 400,
      code: "corrupt",
    },
    {
      status: 400,
      code: "invalid_envelope",
    },
  ],
  "POST /api/support/reports": [
    {
      status: 400,
      code: "payload_key_not_allowed",
    },
    {
      status: 403,
      code: "owner_required",
    },
  ],
  "POST /api/sync/push": [
    {
      status: 401,
      code: "session_revoked",
    },
    {
      status: 403,
      code: "device_session_required",
    },
    {
      status: 409,
      code: "epoch_mismatch",
    },
    {
      status: 502,
      code: "ack_dropped",
    },
    {
      status: 503,
      code: "freeze_reconciliation",
    },
    {
      status: 503,
      code: "network_cut",
    },
  ],
  "POST /api/sync/quarantine/{item_id}/decide": [
    {
      status: 400,
      code: "already_decided",
    },
    {
      status: 403,
      code: "owner_required",
    },
  ],
  "POST /api/sync/recovery/handover": [
    {
      status: 401,
      code: "device_wiped",
    },
    {
      status: 409,
      code: "device_active",
    },
  ],
  "POST /api/sync/recovery/{device_id}/{action}": [
    {
      status: 400,
      code: "acknowledgement_required",
    },
  ],
  "POST /api/tenants": [
    {
      status: 400,
      code: "validation_error",
    },
  ],
  "PUT /api/market/account": [
    {
      status: 403,
      code: "owner_required",
    },
  ],
  "PUT /api/market/profile": [
    {
      status: 400,
      code: "service_areas_required",
    },
    {
      status: 403,
      code: "owner_required",
    },
  ],
  "PUT /api/notifications/preferences": [
    {
      status: 400,
      code: "channel_without_destination",
    },
  ],
  "PUT /api/org/roles": [
    {
      status: 400,
      code: "limit_required",
    },
    {
      status: 400,
      code: "owner_locked",
    },
    {
      status: 403,
      code: "owner_required",
    },
  ],
  "PUT /api/org/settings": [
    {
      status: 400,
      code: "cash_method_required",
    },
    {
      status: 400,
      code: "cost_policy_invalid",
    },
    {
      status: 400,
      code: "too_wide",
    },
    {
      status: 403,
      code: "owner_required",
    },
    {
      status: 409,
      code: "conflict",
    },
  ],
  "PUT /api/portal/{slug}/me": [
    {
      status: 400,
      code: "all_channels_off",
    },
  ],
};
