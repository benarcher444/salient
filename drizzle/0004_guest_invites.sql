ALTER TABLE `games` ADD `invite_token` text;--> statement-breakpoint
ALTER TABLE `users` ADD `is_guest` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `guest_game_id` text;