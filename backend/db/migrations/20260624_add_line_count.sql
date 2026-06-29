-- Migration to add line_count column to threads table
ALTER TABLE threads ADD COLUMN line_count INTEGER NOT NULL DEFAULT 10;
