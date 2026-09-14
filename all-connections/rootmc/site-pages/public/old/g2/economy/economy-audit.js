/** Live economy audit - reconciles ledger, physical scans, bonds, and activity trackers. */
(function () {
  function fmtGold(n) {
    if (!Number.isFinite(n)) return "\u2014";
    return n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + " G";
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function fmtWhen(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    } catch (_e) {
      return String(iso);
    }
  }

  function mintTotals(mintDept) {
    var tr = (mintDept && mintDept.transparency) || {};
    var grossIn = Number(tr.ledger_gross_in_g);
    var redeemed = Number(tr.ledger_redeemed_out_g);
    var net = Number(tr.ledger_net_backing_g);
    if (!Number.isFinite(grossIn) && Number.isFinite(net)) grossIn = net > 0 ? net : 0;
    if (!Number.isFinite(redeemed) && Number.isFinite(net)) redeemed = net < 0 ? Math.abs(net) : 0;
    if (!Number.isFinite(net) && Number.isFinite(grossIn) && Number.isFinite(redeemed)) net = grossIn - redeemed;
    return {
      grossIn: Number.isFinite(grossIn) ? grossIn : 0,
      redeemed: Number.isFinite(redeemed) ? redeemed : 0,
      net: Number.isFinite(net) ? net : 0,
    };
  }

  function buildModel(reserve, goldSupply, bonds, mintDept) {
    var payable = (reserve && reserve.payable_supply) || {};
    var ns = (reserve && reserve.note_supply) || {};
    var found = (reserve && reserve.gold_found_summary) || {};
    var physScan = (reserve && reserve.physical_gold_storage_summary) || {};
    var gs = (goldSupply && goldSupply.totals) || {};
    var tr = (mintDept && mintDept.transparency) || {};
    var mt = (mintDept && mintDept.totals) || {};
    var bondSum = (bonds && bonds.summary) || {};
    var mint = mintTotals(mintDept);

    var walletNotes = Number(ns.player_notes_g) || Number(gs.notes_g) || Number(tr.player_wallet_notes_g) || 0;
    var reserveVault = Number(reserve && reserve.balance) || Number(ns.reserve_notes_g) || Number(tr.reserve_notes_g) || 0;
    var scannedPhysical = Number(physScan.total_storage_g) || Number(gs.physical_g) || 0;
    var unmintedPhysical = Number(tr.physical_items_unminted_g) || Number(mt.unminted_gold_items_g) || 0;
    var foundPhysical = Number(found.physical_mined_since_july_g) || Number(gs.found_physical_g) || 0;
    var foundTotal = Number(found.mined_since_july_g) || 0;
    var foundLoot = Number(found.loot_since_july_g);
    if (!Number.isFinite(foundLoot) && Number.isFinite(foundTotal)) {
      foundLoot = Math.max(0, foundTotal - foundPhysical);
    }

    return {
      walletNotes: walletNotes,
      reserveVault: reserveVault,
      bondPrincipal: Number(bondSum.total_principal_g) || 0,
      bondHolders: Number(bondSum.holder_count) || 0,
      bondUncollected: Number(bondSum.uncollected_g) || 0,
      bondPool24h: Number(bondSum.pool_24h_g) || 0,
      mintGrossIn: mint.grossIn || Number(reserve && reserve.gold_minted_post_reset_ledger) || 0,
      mintRedeemed: mint.redeemed,
      mintNet: mint.net || Number(ns.gold_mined_g) || 0,
      backingPct: Number(ns.backing_pct),
      overIssue: Number(ns.over_issue_g) || 0,
      surplusHeadroom: Number(ns.surplus_mint_headroom_g) || 0,
      scannedPhysical: scannedPhysical,
      unmintedPhysical: unmintedPhysical,
      foundPhysical: foundPhysical,
      foundLoot: Number.isFinite(foundLoot) ? foundLoot : 0,
      foundTotal: foundTotal,
      donationsBurned: Number(ns.notes_retired_donation_g) || Number(reserve && reserve.notes_retired_donation_g) || 0,
      notesRetired: Number(ns.notes_retired_g) || 0,
      integritySummary: (reserve && reserve.supply_integrity && reserve.supply_integrity.summary) || "",
      integrityStatus: (reserve && reserve.supply_integrity && reserve.supply_integrity.status) || "ok",
      syncedAt: (reserve && reserve.synced_at) || (goldSupply && goldSupply.synced_at) || (bonds && bonds.synced_at) || null,
      heldCirculation: walletNotes + scannedPhysical,
      totalPayable: Number(payable.total_payable_g) || 0,
      personalBondPrincipal: Number(payable.personal_bond_principal_g) || 0,
      townBankG: Number(payable.town_bank_g) || 0,
      nationBankG: Number(payable.nation_bank_g) || 0,
      payableCoveragePct: Number(payable.coverage_pct),
      mintSurplusG: Number(payable.mint_surplus_g),
      missingG: Number(payable.missing_g != null ? payable.missing_g : payable.unaccounted_g),
      goldStoredG: Number(payable.gold_stored_g || payable.mint_backing_g),
      goldCirculatingG: Number(payable.gold_circulating_g || payable.private_claims_g || payable.total_payable_g),
      goldBackedBondsG: Number(payable.gold_backed_bonds_g || payable.personal_bond_principal_g),
      reserveManagedG: Number(payable.reserve_managed_g),
      payableSummary: String(payable.summary || ""),
    };
  }

  function auditRow(label, value, meta, link) {
    var valHtml = "<span class=\"economy-audit-value\">" + esc(value) + "</span>";
    if (link) valHtml = "<a class=\"economy-audit-value-link\" href=\"" + esc(link) + "\">" + esc(value) + "</a>";
    return "<tr><th scope=\"row\">" + esc(label) + "</th><td>" + valHtml
      + (meta ? "<span class=\"economy-audit-meta\">" + esc(meta) + "</span>" : "") + "</td></tr>";
  }

  function renderSection(title, note, rows) {
    return "<div class=\"economy-audit-block\"><h3 class=\"economy-audit-block-title\">" + esc(title) + "</h3>"
      + (note ? "<p class=\"rmc-muted economy-audit-block-note\">" + esc(note) + "</p>" : "")
      + "<table class=\"economy-audit-table\"><tbody>" + rows.join("") + "</tbody></table></div>";
  }

  function render(model) {
    var panel = document.getElementById("live-audit");
    if (!panel || !model) return;

    var backingLabel = Number.isFinite(model.payableCoveragePct)
      ? model.payableCoveragePct.toFixed(1) + "%"
      : Number.isFinite(model.backingPct)
        ? model.backingPct.toFixed(1) + "%"
        : "\u2014";
    var shortfallLabel = model.mintSurplusG < -0.01
      ? fmtGold(Math.abs(model.mintSurplusG)) + " short vs stored gold"
      : model.overIssue > 0.01
        ? fmtGold(model.overIssue) + " short"
        : model.missingG > 0.01
          ? fmtGold(model.missingG) + " Missing (unaccounted)"
          : "Balanced";

    var ledgerRows = [
      auditRow("Gold stored (/mint)", fmtGold(model.goldStoredG || model.mintNet),
        "legit map gold converted since opening", "/g2/mint/"),
      auditRow("Gold circulating", fmtGold(model.goldCirculatingG || model.totalPayable),
        "private claims - wallets + town/nation + bond paper", "#eco-note-panel"),
      Number.isFinite(model.reserveManagedG)
        ? auditRow("Server Reserve manages", fmtGold(model.reserveManagedG),
          "mint - private claims (over-issue is negative)", "#server-reserve")
        : "",
      model.missingG > 0.01
        ? auditRow("Missing (unaccounted)", fmtGold(model.missingG), "managed residual above vault Notes")
        : "",
      auditRow("Coverage vs stored gold", backingLabel, shortfallLabel),
      auditRow("Player wallet Notes", fmtGold(model.walletNotes), "circulating G in Vault", "/g2/balances/"),
      auditRow("Server Reserve vault", fmtGold(model.reserveVault), "towny-server custodial Notes", "#server-reserve"),
      auditRow("Gold Backed Bond principal", fmtGold(model.bondPrincipal),
        model.bondHolders + " holders  -  " + fmtGold(model.bondUncollected) + " uncollected coupons", "/g2/economy/bonds/"),
      auditRow("/mint ledger - gross in", fmtGold(model.mintGrossIn), "physical \u2192 Notes since 3 Jul", "/g2/mint/"),
      auditRow("/mint ledger - redeemed", fmtGold(model.mintRedeemed), "Notes \u2192 physical (/mint gold)", "/g2/mint/"),
      auditRow("/mint ledger - net backing", fmtGold(model.mintNet), "audited conversion total", "/g2/mint/"),
      model.totalPayable > 0.01
        ? auditRow("Town + nation banks", fmtGold(model.townBankG + model.nationBankG), "Towny treasury balances", "/g2/balances/")
        : "",
      model.goldBackedBondsG > 0.01
        ? auditRow("Personal Gold Backed Bonds", fmtGold(model.goldBackedBondsG), "paper /bonds - not double-counted with town auto-bonds", "/g2/economy/bonds/")
        : "",
      auditRow("Backing vs wallet Notes", Number.isFinite(model.backingPct) ? model.backingPct.toFixed(1) + "%" : "\u2014",
        (model.overIssue > 0.01 ? fmtGold(model.overIssue) + " short" : "wallet-only view")
          + (model.surplusHeadroom > 0.01 ? "  -  " + fmtGold(model.surplusHeadroom) + " surplus headroom" : "")),
      auditRow("Donations burned (/pay reserve)", fmtGold(model.donationsBurned), "NOTE_BURN - not reserve inflow"),
      auditRow("Notes retired (tax + corrections)", fmtGold(model.notesRetired), "historical overrun paydown"),
    ];

    var physicalRows = [
      auditRow("Scanned physical gold", fmtGold(model.scannedPhysical),
        "held items - last server scan (partial)", "#gold-supply"),
      auditRow("Unminted physical (inventory)", fmtGold(model.unmintedPhysical),
        "gold items at peg, not yet /mint", "/g2/mint/"),
      auditRow("Wallet + scanned physical", fmtGold(model.heldCirculation),
        "best live holder snapshot", "#gold-supply"),
      auditRow("Physical mined (tracker)", fmtGold(model.foundPhysical),
        "ore & blocks since 3 Jul - activity, not holdings", "/mint/#gold-found"),
      auditRow("Loot & pickups (tracker)", fmtGold(model.foundLoot),
        "chests, mobs, ground - not /mint", "/mint/#gold-found"),
      auditRow("Gold-found tracker total", fmtGold(model.foundTotal),
        "all sources since 3 Jul", "/g2/leaderboard/"),
    ];

    var bondRows = [
      auditRow("24h Gold Backed Bond pool", fmtGold(model.bondPool24h), "share of reserve inflows", "/g2/economy/bonds/"),
      auditRow("Active Gold Backed Bond principal", fmtGold(model.bondPrincipal), "deposited via /bonds", "/g2/economy/bonds/"),
    ];

    var html = renderSection(
      "Ledger & circulation",
      "Audited treasury and wallet Notes - separate from activity trackers.",
      ledgerRows,
    )
      + renderSection(
        "Physical & activity",
        "Scans and trackers measure different things than the /mint ledger. Tracker loot excludes economy payouts after the gold-found plugin fix.",
        physicalRows,
      )
      + renderSection("Gold Backed Bonds", "Savings certificates backed by stored /mint gold - principal in reserve custody; coupons pay physical gold.", bondRows);

    var body = document.getElementById("eco-audit-body");
    if (body) body.innerHTML = html;

    var summary = document.getElementById("eco-audit-summary");
    if (summary) {
      summary.textContent = model.payableSummary
        || model.integritySummary
        || ("Total payable " + fmtGold(model.totalPayable || model.walletNotes)
          + "  -  /mint net " + fmtGold(model.mintNet)
          + "  -  scanned physical " + fmtGold(model.scannedPhysical));
    }

    var alert = document.getElementById("eco-audit-alert");
    if (alert) {
      var warn = model.integrityStatus && model.integrityStatus !== "ok";
      alert.hidden = !warn;
      if (warn) alert.textContent = model.integritySummary || "Supply check flagged a mismatch.";
    }

    var meta = document.getElementById("eco-audit-meta");
    if (meta) {
      meta.textContent = model.syncedAt
        ? "Synced " + fmtWhen(model.syncedAt) + "  -  reserve + gold-supply + bonds + /mint department"
        : "Live audit from game server APIs";
    }

    panel.hidden = false;
  }

  window.RootMcEconomyAudit = { buildModel: buildModel, render: render };
})();
