"""Public Ava finance board — sanitized aggregates from ops ledger + Stripe snapshot."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from apps.core import config

FINANCE_DIRS = [
    config.DATA_DIR / "finance",
]
GOALS_JSON = (
    Path(__file__).resolve().parents[3]
    / "packages"
    / "web"
    / "avaivy.cloud"
    / "src"
    / "goals.json"
)
GOALS_JSON_FALLBACKS = [
    config.DATA_DIR / "goals.json",
]


def _read_json(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _finance_file(name: str) -> Path | None:
    for root in FINANCE_DIRS:
        p = root / name
        if p.is_file():
            return p
    return None


def _monthly(amount: float, period: str | None) -> float:
    p = (period or "month").lower()
    if p in ("year", "annual", "yr"):
        return amount / 12.0
    if p in ("week", "weekly"):
        return amount * 52.0 / 12.0
    if p in ("day", "daily"):
        return amount * 30.0
    return amount


def _collect_lines(ledger: dict) -> tuple[list[dict], list[dict], list[dict]]:
    expenses: list[dict] = []
    income: list[dict] = []
    actions: list[dict] = []

    def add_exp(row: dict, project: str, account: str = ""):
        amt = float(row.get("amountUsd") or 0)
        period = str(row.get("period") or "month")
        expenses.append(
            {
                "id": row.get("id"),
                "label": row.get("label") or "Expense",
                "amountUsd": amt,
                "monthlyUsd": round(_monthly(amt, period), 2),
                "period": period,
                "category": row.get("category") or "ops",
                "project": project,
                "account": account,
                "status": "current" if amt or row.get("updatedAt") else "planned",
                "note": row.get("note") or "",
                "updatedAt": row.get("updatedAt"),
            }
        )

    def add_inc(row: dict, project: str, account: str = ""):
        amt = float(row.get("amountUsd") or 0)
        period = str(row.get("period") or "month")
        income.append(
            {
                "id": row.get("id"),
                "label": row.get("label") or "Income",
                "amountUsd": amt,
                "monthlyUsd": round(_monthly(amt, period), 2),
                "period": period,
                "project": project,
                "account": account,
                "status": "current" if amt or row.get("updatedAt") else "planned",
                "note": row.get("note") or "",
                "updatedAt": row.get("updatedAt"),
            }
        )

    for proj in ledger.get("projects") or []:
        pname = str(proj.get("name") or proj.get("id") or "project")
        for row in proj.get("expenses") or []:
            add_exp(row, pname)
        for row in proj.get("income") or []:
            add_inc(row, pname)
        for acct in proj.get("accounts") or []:
            aname = str(acct.get("name") or acct.get("id") or "")
            for row in acct.get("expenses") or []:
                add_exp(row, pname, aname)
            for row in acct.get("income") or []:
                add_inc(row, pname, aname)

    # Top-level copies of the same ids (this ledger lists Starlink twice).
    for row in ledger.get("expenses") or []:
        if not any(e.get("id") == row.get("id") for e in expenses):
            add_exp(row, "RootMC ops")
    for row in ledger.get("otherIncome") or []:
        if not any(i.get("id") == row.get("id") for i in income):
            add_inc(row, "RootMC ops")

    def dedupe(rows: list[dict]) -> list[dict]:
        seen: set[str] = set()
        out: list[dict] = []
        for r in rows:
            key = str(r.get("id") or f"{r.get('label')}|{r.get('project')}")
            if key in seen:
                continue
            seen.add(key)
            out.append(r)
        return out

    expenses = dedupe(expenses)
    income = dedupe(income)
    return expenses, income, actions


def _stripe_public(snap: dict) -> dict:
    recent = []
    for tx in snap.get("recent") or []:
        recent.append(
            {
                "id": tx.get("id"),
                "type": tx.get("type"),
                "amountUsd": float(tx.get("amount") or 0),
                "feeUsd": float(tx.get("fee") or 0),
                "netUsd": float(tx.get("net") or 0),
                "description": tx.get("description") or tx.get("type") or "transaction",
                "at": tx.get("created"),
            }
        )
    # Expected MRR: trailing ~30d subscription credits (honest proxy — not invented ARR)
    sub_payments = [
        t
        for t in recent
        if t.get("type") == "payment"
        and "subscription" in str(t.get("description") or "").lower()
        and float(t.get("amountUsd") or 0) > 0
    ]
    income_30d = float(snap.get("income30dUsd") or 0)
    sub_30d = round(sum(float(t["amountUsd"]) for t in sub_payments), 2)
    expected_mrr = round(sub_30d if sub_30d > 0 else income_30d, 2)

    # Dedupe subscription lines by amount + label for the board
    seen_subs: set[str] = set()
    subscriptions = []
    for t in sub_payments:
        key = f"{t.get('description')}|{t.get('amountUsd')}"
        if key in seen_subs:
            continue
        seen_subs.add(key)
        count = sum(
            1
            for x in sub_payments
            if x.get("description") == t.get("description")
            and float(x.get("amountUsd") or 0) == float(t.get("amountUsd") or 0)
        )
        subscriptions.append(
            {
                "label": t.get("description") or "Subscription",
                "amountUsd": t.get("amountUsd"),
                "lastChargeAt": t.get("at"),
                "recentCharges": count,
                "status": "active",
            }
        )

    return {
        "availableUsd": float(snap.get("usdAvailable") or 0),
        "pendingUsd": float(snap.get("usdPending") or 0),
        "income30dUsd": income_30d,
        "fees30dUsd": float(snap.get("fees30dUsd") or 0),
        "payouts30dUsd": float(snap.get("payouts30dUsd") or 0),
        "expectedMrrUsd": expected_mrr,
        "actions": recent,
        "subscriptions": subscriptions,
        "fetchedAt": snap.get("fetchedAt"),
        "source": "payment_snapshot",
    }


def _goals_path() -> Path | None:
    if GOALS_JSON.is_file():
        return GOALS_JSON
    for p in GOALS_JSON_FALLBACKS:
        if p.is_file():
            return p
    return None


def _next_mandatory_goal() -> dict | None:
    path = _goals_path()
    data = _read_json(path) if path else {}
    goals = list(data.get("goals") or [])
    monetary = []
    for g in goals:
        target = g.get("monetary_target_usd")
        if target is None:
            continue
        try:
            t = float(target)
        except (TypeError, ValueError):
            continue
        if t <= 0:
            continue
        if str(g.get("status") or "").lower() in ("done", "complete", "cancelled"):
            continue
        raised = float(g.get("amount_raised_usd") or 0)
        factors = g.get("factors") or {}
        weights = {
            "operational_impact": 0.4,
            "cost_efficiency": 0.2,
            "funding_readiness": 0.15,
            "strategic_fit": 0.15,
            "time_sensitivity": 0.1,
        }
        score = sum(float(factors.get(k) or 0) * w for k, w in weights.items())
        # Prefer near-term hardware wishlist as mandatory purchase
        boost = 25.0 if str(g.get("category") or "") == "hardware" else 0.0
        monetary.append((score + boost, t - raised, g, t, raised))
    if not monetary:
        return None
    monetary.sort(key=lambda x: (-x[0], x[1]))
    _score, remaining, g, target, raised = monetary[0]
    root_id = g.get("root_goal_id")
    return {
        "goalId": g.get("goal_id"),
        "title": g.get("title"),
        "status": g.get("status"),
        "targetUsd": target,
        "raisedUsd": raised,
        "remainingUsd": round(max(0, target - raised), 2),
        "mandatory": True,
        "href": f"/goals/view?id={root_id}" if root_id else "/goals",
        "description": g.get("description") or "",
        "hardware": g.get("hardware") or [],
        "donateWallet": g.get("donate_wallet"),
    }


def public_finance_board() -> dict[str, Any]:
    ledger_path = _finance_file("ops-ledger.json")
    snap_path = _finance_file("stripe-snapshot.json")
    ledger = _read_json(ledger_path) if ledger_path else {}
    snap = _read_json(snap_path) if snap_path else {}

    expenses, income, _ = _collect_lines(ledger)
    stripe = _stripe_public(snap) if snap else {
        "availableUsd": 0,
        "pendingUsd": 0,
        "income30dUsd": 0,
        "fees30dUsd": 0,
        "payouts30dUsd": 0,
        "expectedMrrUsd": 0,
        "actions": [],
        "subscriptions": [],
    }

    exp_monthly = round(sum(float(e.get("monthlyUsd") or 0) for e in expenses), 2)
    inc_monthly = round(sum(float(i.get("monthlyUsd") or 0) for i in income), 2)
    ava_low = round(float(stripe.get("income30dUsd") or 0) * 0.10, 2)
    ava_high = round(float(stripe.get("income30dUsd") or 0) * 0.15, 2)

    balances = [
        {
            "id": "pay-available",
            "label": "Payment balance available",
            "amountUsd": stripe.get("availableUsd"),
            "kind": "cash",
        },
        {
            "id": "pay-pending",
            "label": "Payment balance pending",
            "amountUsd": stripe.get("pendingUsd"),
            "kind": "pending",
        },
        {
            "id": "ops-expense-burn",
            "label": "Ops expense burn (ledger)",
            "amountUsd": -exp_monthly,
            "kind": "burn",
            "note": "Monthlyized from ops ledger rows",
        },
        {
            "id": "ava-allocation-band",
            "label": "Ava allocation band (10–15% of ~30d credits)",
            "amountUsdLow": ava_low,
            "amountUsdHigh": ava_high,
            "kind": "allocation",
        },
    ]

    return {
        "ok": True,
        "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "balances": balances,
        "expectedMrrUsd": stripe.get("expectedMrrUsd"),
        "income30dUsd": stripe.get("income30dUsd"),
        "subscriptions": stripe.get("subscriptions") or [],
        "actions": stripe.get("actions") or [],
        "expenses": {
            "current": [e for e in expenses if e.get("status") == "current"],
            "past": [],  # ledger is recurring; past one-offs appear in Stripe actions
            "all": expenses,
            "monthlyTotalUsd": exp_monthly,
        },
        "income": {
            "current": [i for i in income if i.get("status") == "current"],
            "past": [a for a in (stripe.get("actions") or []) if float(a.get("amountUsd") or 0) > 0],
            "all": income,
            "monthlyTotalUsd": inc_monthly,
        },
        "nextMandatoryPurchase": _next_mandatory_goal(),
        "links": {
            "services": "https://rootrecord.info/products",
            "financeAutomation": "https://rootrecord.info/finance-automation",
            "wallets": "/wallets",
            "goals": "/goals",
            "billing": "https://rootrecord.info/billing",
        },
        "notes": [
            "Player Gold never converts to dollars.",
            "Ava allocation is about 10–15% of earned income — never the ops/hosting buffer.",
            "Ledger rows at $0 are placeholders until the desk sets real amounts.",
        ],
        "sources": {
            "ledger": str(ledger_path) if ledger_path else None,
            "stripe": str(snap_path) if snap_path else None,
        },
    }
