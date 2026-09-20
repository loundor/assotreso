<script lang="ts">
  import { onMount } from 'svelte';
  import AsyncState from '../components/AsyncState.svelte';
  import Icon from '../components/Icon.svelte';
  import { api, listFrom } from '../lib/api';
  import { currency, getErrorMessage } from '../lib/utils';
  import type { Category, Project } from '../lib/types';

  export let kind: 'categories' | 'projects';

  type DisplayItem = (Category | Project) & { depth: number };
  let items: Array<Category | Project> = [];
  let projects: Project[] = [];
  let loading = true;
  let error = '';
  let formOpen = false;
  let saving = false;
  let formError = '';
  let name = '';
  let description = '';
  let budget = 0;
  let color = '#3b8068';
  let parentId = '';
  let projectId = '';
  let categoryKind: 'RECETTE' | 'DEPENSE' | 'MIXTE' = 'DEPENSE';

  $: isProject = kind === 'projects';
  $: title = isProject ? 'Projets' : 'Catégories et rubriques';
  $: availableCategoryParents = (items as Category[]).filter((item) =>
    (item.kind ?? 'DEPENSE') === categoryKind && String(item.projectId ?? item.project_id ?? '') === projectId
  );
  $: displayItems = hierarchy(items);

  function itemParent(item: Category | Project): string {
    return String(item.parentId ?? item.parent_id ?? '');
  }

  function hierarchy(source: Array<Category | Project>): DisplayItem[] {
    const byParent = new Map<string, Array<Category | Project>>();
    for (const item of source) {
      const key = itemParent(item);
      byParent.set(key, [...(byParent.get(key) ?? []), item]);
    }
    for (const children of byParent.values()) children.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const result: DisplayItem[] = [];
    const visited = new Set<string>();
    const add = (parent: string, depth: number) => {
      for (const item of byParent.get(parent) ?? []) {
        const id = String(item.id);
        if (visited.has(id)) continue;
        visited.add(id);
        result.push({ ...item, depth });
        add(id, depth + 1);
      }
    };
    add('', 0);
    for (const item of source) if (!visited.has(String(item.id))) result.push({ ...item, depth: 0 });
    return result;
  }

  function resetForm() {
    name = '';
    description = '';
    budget = 0;
    color = '#3b8068';
    parentId = '';
    projectId = '';
    categoryKind = 'DEPENSE';
    formError = '';
  }

  async function load() {
    loading = true;
    error = '';
    try {
      const requests: Promise<unknown>[] = [api.get(kind)];
      if (!isProject) requests.push(api.get('projects'));
      const [resourceResult, projectResult] = await Promise.all(requests);
      items = listFrom<Category | Project>(resourceResult, [kind]);
      projects = isProject ? (items as Project[]) : listFrom<Project>(projectResult, ['projects']);
    } catch (caught) {
      error = getErrorMessage(caught);
    } finally {
      loading = false;
    }
  }

  async function save() {
    saving = true;
    formError = '';
    try {
      await api.post(kind, isProject
        ? { name, description, budget: Number(budget), parentId: parentId || null, active: true }
        : { name, kind: categoryKind, color, projectId: projectId || null, parentId: parentId || null });
      resetForm();
      formOpen = false;
      await load();
    } catch (caught) {
      formError = getErrorMessage(caught);
    } finally {
      saving = false;
    }
  }

  function toggleForm() {
    formOpen = !formOpen;
    if (!formOpen) resetForm();
  }

  onMount(load);
</script>

<div class="page-stack">
  <div class="page-intro">
    <div>
      <h2>{title}</h2>
      <p>{isProject ? 'Structurez vos activités en projets et sous-projets.' : 'Créez des catégories globales ou des rubriques propres à un projet.'}</p>
    </div>
    <button class="btn btn-primary" on:click={toggleForm}>
      <Icon name={formOpen ? 'close' : 'plus'} size={18}/>{formOpen ? 'Annuler' : `Ajouter ${isProject ? 'un projet' : 'une rubrique'}`}
    </button>
  </div>

  {#if formOpen}
    <form class="panel inline-form" on:submit|preventDefault={save}>
      <div class="form-heading">
        <h3>{isProject ? 'Nouveau projet' : 'Nouvelle catégorie ou rubrique'}</h3>
        <p>{isProject ? 'Un projet parent transforme ce projet en sous-projet.' : 'Choisissez un projet pour créer une rubrique dédiée, ou laissez vide pour une catégorie globale.'}</p>
      </div>
      {#if formError}<div class="alert" role="alert">{formError}</div>{/if}
      <div class="form-grid">
        <label>Nom<input bind:value={name} required placeholder={isProject ? 'Festival annuel' : 'Télécommunications'}/></label>
        {#if isProject}
          <label>Projet parent
            <select bind:value={parentId}><option value="">Aucun — projet principal</option>{#each hierarchy(projects) as project}<option value={project.id}>{'— '.repeat(project.depth)}{project.name}</option>{/each}</select>
          </label>
          <label>Budget prévisionnel (€)<input type="number" min="0" step="0.01" bind:value={budget}/></label>
          <label class="span-2">Description<textarea bind:value={description} rows="3" placeholder="Objectif du projet…"></textarea></label>
        {:else}
          <label>Type
            <select bind:value={categoryKind} on:change={() => parentId = ''}><option value="DEPENSE">Dépense</option><option value="RECETTE">Recette</option><option value="MIXTE">Mixte</option></select>
          </label>
          <label>Projet associé
            <select bind:value={projectId} on:change={() => parentId = ''}><option value="">Aucun — catégorie globale</option>{#each hierarchy(projects) as project}<option value={project.id}>{'— '.repeat(project.depth)}{project.name}</option>{/each}</select>
          </label>
          <label>Catégorie parente
            <select bind:value={parentId}><option value="">Aucune</option>{#each hierarchy(availableCategoryParents) as category}<option value={category.id}>{'— '.repeat(category.depth)}{category.name}</option>{/each}</select>
          </label>
          <label>Couleur<input class="color-input" type="color" bind:value={color}/></label>
        {/if}
      </div>
      <div class="form-actions"><button class="btn btn-primary" disabled={saving}>{saving ? 'Enregistrement…' : 'Créer'}</button></div>
    </form>
  {/if}

  <AsyncState {loading} {error} empty={!items.length} emptyTitle={`Aucun${isProject ? ' projet' : 'e catégorie'}`} emptyText={`Créez ${isProject ? 'un premier projet' : 'une première catégorie'} pour organiser votre trésorerie.`} onRetry={load}>
    <div class="resource-grid">
      {#each displayItems as item}
        <article class="panel resource-card" style:margin-left={`${Math.min(item.depth, 3) * 18}px`}>
          <span class="resource-icon" style:background={isProject ? 'var(--green-soft)' : ('color' in item && item.color ? `${item.color}20` : 'var(--green-soft)')} style:color={'color' in item && item.color ? item.color : 'var(--green)'}><Icon name={isProject ? 'folder' : 'tag'}/></span>
          <div>
            <div class="resource-title-line"><h3>{item.name}</h3>{#if item.depth > 0}<span class="soft-badge">Niveau {item.depth + 1}</span>{/if}</div>
            {#if isProject && 'description' in item}<p>{item.description || 'Aucune description'}</p>{/if}
            {#if !isProject && 'project_name' in item && item.project_name}<p>Rubrique du projet <strong>{item.project_name}</strong></p>{:else if !isProject}<p>Catégorie globale · {'kind' in item ? item.kind : 'DEPENSE'}</p>{/if}
          </div>
          {#if isProject && 'budget' in item}
            <div class="resource-meta"><span>Budget</span><strong>{currency.format(item.budget ?? 0)}</strong><small>{currency.format(item.expense ?? 0)} dépensés</small></div>
          {/if}
        </article>
      {/each}
    </div>
  </AsyncState>
</div>
