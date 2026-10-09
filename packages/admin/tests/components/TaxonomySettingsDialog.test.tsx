import { Toasty } from "@cloudflare/kumo";
import { i18n } from "@lingui/core";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaxonomyManager } from "../../src/components/TaxonomyManager.js";
import { TaxonomySettingsDialog } from "../../src/components/TaxonomySettingsDialog.js";
import type { TaxonomyDef, UpdateTaxonomyInput } from "../../src/lib/api/taxonomies.js";
import { LocaleDirectionProvider } from "../../src/locales/LocaleDirectionProvider.js";
import { render } from "../utils/render.tsx";

import "../../dist/styles.css";

let saved: TaxonomyDef;
let failSave: boolean;
let failRead: boolean;
let writes: Array<{ locale: string | null; input: UpdateTaxonomyInput }>;

function response(data: unknown) {
	return Promise.resolve(new Response(JSON.stringify({ success: true, data }), { status: 200 }));
}

function Wrapper({ children }: { children: React.ReactNode }) {
	return <Toasty>{children}</Toasty>;
}

function Standalone({ canManage = true, locale = "cs" }: { canManage?: boolean; locale?: string }) {
	const [open, setOpen] = React.useState(true);
	return open ? (
		<TaxonomySettingsDialog
			taxonomyName="genre"
			locale={locale}
			canManage={canManage}
			onClose={() => setOpen(false)}
		/>
	) : (
		<button type="button" onClick={() => setOpen(true)}>
			Reopen settings
		</button>
	);
}

describe("taxonomy definition settings", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal("fetch", vi.fn());
		failSave = false;
		failRead = false;
		writes = [];
		saved = {
			id: "definition-cs",
			name: "genre",
			label: "Genres",
			labelSingular: "Genre",
			hierarchical: true,
			collections: ["posts"],
			locale: "cs",
			translationGroup: "definition-group",
		};
		vi.mocked(fetch).mockImplementation((request, init) => {
			const requestUrl =
				typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
			const url = new URL(requestUrl, "http://localhost");
			if (url.pathname === "/_emdash/api/manifest") {
				return response({ collections: { posts: { label: "Posts" }, pages: { label: "Pages" } } });
			}
			if (url.pathname === "/_emdash/api/taxonomies") return response({ taxonomies: [saved] });
			if (url.pathname === "/_emdash/api/taxonomies/genre/terms") {
				return response({
					terms: [
						{
							id: "term-1",
							name: "genre",
							slug: "story",
							label: "Story",
							children: [],
							count: 2,
							locale: "cs",
							translationGroup: "term-group",
						},
					],
				});
			}
			if (url.pathname === "/_emdash/api/taxonomies/genre") {
				if (init?.method === "PUT") {
					if (typeof init.body !== "string") throw new Error("Expected a JSON request body");
					const input = JSON.parse(init.body) as UpdateTaxonomyInput;
					writes.push({ locale: url.searchParams.get("locale"), input });
					if (failSave)
						return Promise.resolve(
							new Response(
								JSON.stringify({
									success: false,
									error: { code: "VALIDATION_ERROR", message: "Unknown collection" },
								}),
								{ status: 400 },
							),
						);
					saved = {
						...saved,
						...input,
						labelSingular:
							input.labelSingular === null
								? undefined
								: (input.labelSingular ?? saved.labelSingular),
					};
				} else if (failRead) {
					return Promise.resolve(
						new Response(
							JSON.stringify({
								success: false,
								error: { code: "FORBIDDEN", message: "Read access denied" },
							}),
							{ status: 403 },
						),
					);
				}
				return response({ taxonomy: saved });
			}
			throw new Error(`Unexpected request: ${url.pathname}`);
		});
	});

	it("keeps the dialog and its actions usable in Arabic RTL mode", async () => {
		const previousLocale = i18n.locale;
		i18n.loadAndActivate({ locale: "ar", messages: {} });
		try {
			const screen = await render(
				<LocaleDirectionProvider>
					<Standalone />
				</LocaleDirectionProvider>,
				{ wrapper: Wrapper },
			);
			await screen.getByRole("textbox", { name: "Label" }).fill("أنواع القراءة");
			const dialog = screen.getByRole("dialog").element();
			expect(getComputedStyle(dialog).direction).toBe("rtl");
			const bounds = dialog.getBoundingClientRect();
			expect(bounds.left).toBeGreaterThanOrEqual(0);
			expect(bounds.right).toBeLessThanOrEqual(window.innerWidth);
			const heading = screen
				.getByRole("heading", { name: "Edit taxonomy" })
				.element()
				.getBoundingClientRect();
			const close = screen
				.getByRole("button", { name: "Close", exact: true })
				.element()
				.getBoundingClientRect();
			expect(close.right).toBeLessThan(heading.right);
			await screen.getByRole("button", { name: "Save changes", exact: true }).click();
			await screen.getByRole("button", { name: "Reopen settings" }).click();
			await expect
				.element(screen.getByRole("textbox", { name: "Label" }))
				.toHaveValue("أنواع القراءة");
		} finally {
			i18n.activate(previousLocale);
			document.documentElement.setAttribute("dir", "ltr");
		}
	});

	it("opens settings from the taxonomy menu and refreshes the heading after saving", async () => {
		const screen = await render(<TaxonomyManager taxonomyName="genre" canManageTaxonomies />, {
			wrapper: Wrapper,
		});
		await screen.getByRole("button", { name: "More actions for Genres" }).click();
		await screen.getByRole("menuitem", { name: "Edit taxonomy" }).click();
		await expect
			.element(screen.getByRole("textbox", { name: "Identifier", exact: true }))
			.toHaveValue("genre");
		await expect
			.element(screen.getByRole("textbox", { name: "Identifier", exact: true }))
			.toBeDisabled();
		await screen.getByRole("textbox", { name: "Label", exact: true }).fill("Reading genres");
		await screen.getByRole("button", { name: "Save changes", exact: true }).click();
		await expect
			.element(screen.getByRole("heading", { name: "Reading genres", exact: true }))
			.toBeInTheDocument();
		await expect.element(screen.getByText("Story", { exact: true })).toBeInTheDocument();
		expect(writes).toEqual([{ locale: "cs", input: { label: "Reading genres" } }]);
	});

	it("edits one label while preserving the stored singular form", async () => {
		const screen = await render(<Standalone />, { wrapper: Wrapper });
		await screen.getByRole("textbox", { name: "Label", exact: true }).fill("Reading genres");
		expect(document.querySelectorAll('input:not([type="checkbox"])')).toHaveLength(2);
		await screen.getByRole("button", { name: "Save changes", exact: true }).click();
		await screen.getByRole("button", { name: "Reopen settings" }).click();
		await expect
			.element(screen.getByRole("textbox", { name: "Label", exact: true }))
			.toHaveValue("Reading genres");
		expect(saved.labelSingular).toBe("Genre");
		expect(writes).toEqual([{ locale: "cs", input: { label: "Reading genres" } }]);
	});

	it("saves false hierarchy and an empty collection list and refetches them", async () => {
		const screen = await render(<Standalone />, { wrapper: Wrapper });
		await screen
			.getByRole("checkbox", {
				name: "Hierarchical (like categories, with parent/child relationships)",
			})
			.click();
		await screen.getByRole("checkbox", { name: "Posts", exact: true }).click();
		await screen.getByRole("button", { name: "Save changes", exact: true }).click();
		await screen.getByRole("button", { name: "Reopen settings" }).click();
		await expect
			.element(
				screen.getByRole("checkbox", {
					name: "Hierarchical (like categories, with parent/child relationships)",
				}),
			)
			.not.toBeChecked();
		await expect
			.element(screen.getByRole("checkbox", { name: "Posts", exact: true }))
			.not.toBeChecked();
		expect(writes).toEqual([{ locale: "cs", input: { hierarchical: false, collections: [] } }]);
	});

	it("does not overwrite collection changes made while editing a label", async () => {
		const screen = await render(<Standalone />, { wrapper: Wrapper });
		await expect.element(screen.getByRole("textbox", { name: "Label" })).toHaveValue("Genres");
		saved = { ...saved, collections: ["pages"], hierarchical: false };
		await screen.getByRole("textbox", { name: "Label" }).fill("New label");
		await screen.getByRole("button", { name: "Save changes", exact: true }).click();
		await screen.getByRole("button", { name: "Reopen settings" }).click();
		await expect
			.element(screen.getByRole("checkbox", { name: "Pages", exact: true }))
			.toBeChecked();
		await expect
			.element(
				screen.getByRole("checkbox", {
					name: "Hierarchical (like categories, with parent/child relationships)",
				}),
			)
			.not.toBeChecked();
		expect(writes[0]?.input).toEqual({ label: "New label" });
	});

	it("shows the actual fallback locale and saves labels to that definition", async () => {
		const screen = await render(<Standalone locale="fr" />, { wrapper: Wrapper });
		await expect
			.element(screen.getByText("No definition exists in fr. Labels are shown and saved in cs."))
			.toBeInTheDocument();
		await screen.getByRole("textbox", { name: "Label" }).fill("Fallback label");
		await screen.getByRole("button", { name: "Save changes", exact: true }).click();
		await expect
			.element(screen.getByRole("button", { name: "Reopen settings" }))
			.toBeInTheDocument();
		expect(writes[0]).toEqual({ locale: "cs", input: { label: "Fallback label" } });
	});

	it("allows read-only inspection without a save action", async () => {
		const screen = await render(<Standalone canManage={false} />, { wrapper: Wrapper });
		await expect.element(screen.getByRole("textbox", { name: "Label" })).toHaveValue("Genres");
		await expect.element(screen.getByRole("textbox", { name: "Label" })).toBeDisabled();
		await expect
			.element(screen.getByRole("checkbox", { name: "Posts", exact: true }))
			.toBeDisabled();
		expect(document.querySelector('button[type="submit"]')).toBeNull();
		document
			.querySelector("form")!
			.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
		expect(writes).toEqual([]);
	});

	it("keeps entered values after a rejected save and allows an explicit retry", async () => {
		failSave = true;
		const screen = await render(<Standalone />, { wrapper: Wrapper });
		await screen.getByRole("textbox", { name: "Label" }).fill("Unsaved label");
		await screen.getByRole("button", { name: "Save changes", exact: true }).click();
		await expect.element(screen.getByRole("alert")).toHaveTextContent("Unknown collection");
		await expect
			.element(screen.getByRole("textbox", { name: "Label" }))
			.toHaveValue("Unsaved label");
		expect(writes).toHaveLength(1);
		failSave = false;
		await screen.getByRole("button", { name: "Save changes", exact: true }).click();
		await screen.getByRole("button", { name: "Reopen settings" }).click();
		await expect
			.element(screen.getByRole("textbox", { name: "Label" }))
			.toHaveValue("Unsaved label");
	});

	it("shows a failed read and can load the details on retry", async () => {
		failRead = true;
		const screen = await render(<Standalone />, { wrapper: Wrapper });
		await expect.element(screen.getByRole("alert")).toHaveTextContent("Read access denied");
		expect(document.querySelector("form")).toBeNull();
		failRead = false;
		await screen.getByRole("button", { name: "Try again" }).click();
		await expect.element(screen.getByRole("textbox", { name: "Label" })).toHaveValue("Genres");
	});
});
