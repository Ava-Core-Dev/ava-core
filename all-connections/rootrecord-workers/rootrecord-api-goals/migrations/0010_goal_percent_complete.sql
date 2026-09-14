-- Manual progress for non-monetary goals (and override display when no USD target).
ALTER TABLE rg_goals ADD COLUMN percent_complete INTEGER NOT NULL DEFAULT 0;
