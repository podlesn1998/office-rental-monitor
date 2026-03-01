ALTER TABLE `listings` ADD `ceilingHeight` int;--> statement-breakpoint
ALTER TABLE `listings` ADD `status` enum('new','viewed','interesting') DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE `listings` ADD `telegramMessageId` bigint;--> statement-breakpoint
ALTER TABLE `searchConfig` ADD `officeType` varchar(64) DEFAULT 'office' NOT NULL;--> statement-breakpoint
ALTER TABLE `searchConfig` ADD `transportType` varchar(32) DEFAULT 'foot' NOT NULL;--> statement-breakpoint
ALTER TABLE `searchConfig` ADD `maxPages` int DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE `searchConfig` ADD `enableCian` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `searchConfig` ADD `enableAvito` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `searchConfig` ADD `enableYandex` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `searchConfig` ADD `minFloor` int;--> statement-breakpoint
ALTER TABLE `searchConfig` ADD `maxFloor` int;--> statement-breakpoint
ALTER TABLE `searchConfig` ADD `keywords` json;--> statement-breakpoint
ALTER TABLE `searchConfig` ADD `districts` json;