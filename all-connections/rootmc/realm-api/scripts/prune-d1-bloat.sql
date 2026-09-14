DELETE FROM rootmc_shop_price_history;
DELETE FROM rootstat_player_item_totals;
DELETE FROM rootstat_server_item_totals;
DELETE FROM rootmc_daily_category_reports;
DELETE FROM weather_data WHERE fetched_at < '2026-06-01T00:00:00.000Z';
