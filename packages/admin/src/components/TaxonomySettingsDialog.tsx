import { Button, Checkbox, Dialog, Input, Toast } from "@cloudflare/kumo";
import { useLingui } from "@lingui/react/macro";
import { X } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { fetchManifest } from "../lib/api/client.js";
import {
	getTaxonomy,
	updateTaxonomy,
	type TaxonomyDef,
	type UpdateTaxonomyInput,
} from "../lib/api/taxonomies.js";
import { DialogError, getMutationError } from "./DialogError.js";

interface TaxonomySettingsDialogProps {
	taxonomyName: string;
	locale?: string;
	canManage: boolean;
	onClose: () => void;
}

export function TaxonomySettingsDialog({
	taxonomyName,
	locale,
	canManage,
	onClose,
}: TaxonomySettingsDialogProps) {
	const { t } = useLingui();
	const [saving, setSaving] = React.useState(false);
	const definition = useQuery({
		queryKey: ["taxonomy-settings", taxonomyName, locale],
		queryFn: () => getTaxonomy(taxonomyName, { locale }),
		staleTime: 0,
		refetchOnWindowFocus: false,
		retry: false,
	});

	return (
		<Dialog.Root open onOpenChange={(open) => !open && !saving && onClose()}>
			<Dialog
				className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] min-w-0 flex-col overflow-hidden p-0 sm:w-[32rem]"
				size="lg"
			>
				<div className="flex shrink-0 items-start justify-between gap-4 border-b border-kumo-line px-6 py-5">
					<div className="min-w-0">
						<Dialog.Title className="text-lg font-semibold">{t`Edit taxonomy`}</Dialog.Title>
						<Dialog.Description className="mt-1 text-sm text-kumo-subtle">
							{t`View and edit how this taxonomy classifies content`}
						</Dialog.Description>
					</div>
					<Button
						type="button"
						variant="ghost"
						shape="square"
						icon={<X className="size-4" aria-hidden="true" />}
						aria-label={t`Close`}
						disabled={saving}
						onClick={onClose}
					/>
				</div>
				{definition.isPending ? (
					<p role="status" className="px-6 py-6 text-kumo-subtle">{t`Loading...`}</p>
				) : definition.isError ? (
					<div className="space-y-4 px-6 py-6">
						<DialogError message={getMutationError(definition.error)} />
						<Button
							variant="outline"
							onClick={() => void definition.refetch()}
						>{t`Try again`}</Button>
					</div>
				) : (
					<TaxonomySettingsForm
						key={`${definition.data.id}:${definition.data.locale}`}
						definition={definition.data}
						requestedLocale={locale}
						canManage={canManage}
						onClose={onClose}
						onSavingChange={setSaving}
					/>
				)}
			</Dialog>
		</Dialog.Root>
	);
}

function TaxonomySettingsForm({
	definition,
	requestedLocale,
	canManage,
	onClose,
	onSavingChange,
}: {
	definition: TaxonomyDef;
	requestedLocale?: string;
	canManage: boolean;
	onClose: () => void;
	onSavingChange: (saving: boolean) => void;
}) {
	const { t } = useLingui();
	const queryClient = useQueryClient();
	const toastManager = Toast.useToastManager();
	const [initial] = React.useState(definition);
	const [label, setLabel] = React.useState(initial.label);
	const [hierarchical, setHierarchical] = React.useState(initial.hierarchical);
	const [collections, setCollections] = React.useState(initial.collections);
	const { data: manifest } = useQuery({ queryKey: ["manifest"], queryFn: fetchManifest });
	const collectionSlugs = [
		...new Set([...Object.keys(manifest?.collections ?? {}), ...initial.collections]),
	];
	const changes: UpdateTaxonomyInput = {};
	if (label.trim() !== initial.label) changes.label = label.trim();
	if (hierarchical !== initial.hierarchical) changes.hierarchical = hierarchical;
	if (
		collections.length !== initial.collections.length ||
		collections.some((slug) => !initial.collections.includes(slug))
	) {
		changes.collections = collections;
	}
	const mutation = useMutation({
		mutationFn: (input: UpdateTaxonomyInput) =>
			updateTaxonomy(initial.name, input, { locale: initial.locale }),
		retry: false,
		onMutate: () => onSavingChange(true),
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["taxonomy-defs"] }),
				queryClient.invalidateQueries({ queryKey: ["taxonomy-def", initial.name] }),
				queryClient.invalidateQueries({ queryKey: ["taxonomy-settings", initial.name] }),
				queryClient.invalidateQueries({ queryKey: ["taxonomy-terms", initial.name] }),
				queryClient.invalidateQueries({ queryKey: ["manifest"] }),
			]);
			toastManager.add({ title: t`Taxonomy updated` });
			onClose();
		},
		onSettled: () => onSavingChange(false),
	});
	const disabled = !canManage || mutation.isPending;
	const hasChanges = Object.keys(changes).length > 0;

	return (
		<form
			className="flex min-h-0 flex-1 flex-col"
			onSubmit={(event) => {
				event.preventDefault();
				if (canManage && !mutation.isPending && hasChanges && label.trim())
					mutation.mutate(changes);
			}}
		>
			<div className="emdash-auto-scrollbar min-h-0 flex-1 space-y-4 overflow-x-hidden overflow-y-auto px-6 py-6">
				<Input
					label={t`Label`}
					value={label}
					onChange={(event) => setLabel(event.target.value)}
					required
					maxLength={200}
					disabled={disabled}
				/>
				<p className="text-sm text-kumo-subtle">{t`Label locale: ${initial.locale}`}</p>
				{requestedLocale && requestedLocale !== initial.locale && (
					<p role="status" className="text-sm text-kumo-subtle">
						{t`No definition exists in ${requestedLocale}. Labels are shown and saved in ${initial.locale}.`}
					</p>
				)}
				{!canManage && (
					<p className="text-sm text-kumo-subtle">{t`You have read-only access to these settings.`}</p>
				)}
				<Input
					label={t`Identifier`}
					value={initial.name}
					disabled
					className="disabled:text-kumo-inactive"
				/>
				<p className="text-xs text-kumo-subtle">{t`The taxonomy identifier cannot be changed.`}</p>
				<Checkbox
					label={t`Hierarchical (like categories, with parent/child relationships)`}
					checked={hierarchical}
					onCheckedChange={setHierarchical}
					disabled={disabled}
				/>
				<div className="space-y-2">
					<p className="text-sm font-medium">{t`Collections`}</p>
					<p className="text-xs text-kumo-subtle">{t`Which content types can use this taxonomy`}</p>
					<div className="space-y-2 rounded-md border border-kumo-line p-3">
						{collectionSlugs.map((slug) => (
							<div key={slug}>
								<Checkbox
									label={manifest?.collections[slug]?.label ?? slug}
									checked={collections.includes(slug)}
									disabled={disabled}
									onCheckedChange={(checked) =>
										setCollections((previous) =>
											checked ? [...previous, slug] : previous.filter((item) => item !== slug),
										)
									}
								/>
							</div>
						))}
					</div>
				</div>
				<p className="text-xs text-kumo-subtle">{t`Hierarchy and collections apply to all locales. Existing terms and assignments are kept.`}</p>
				<DialogError message={getMutationError(mutation.error)} />
			</div>
			<div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-kumo-line px-6 py-4">
				<Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
					{canManage ? t`Cancel` : t`Close`}
				</Button>
				{canManage && (
					<Button
						type="submit"
						variant="primary"
						disabled={!hasChanges || !label.trim() || mutation.isPending}
					>
						{mutation.isPending ? t`Saving...` : t`Save changes`}
					</Button>
				)}
			</div>
		</form>
	);
}
