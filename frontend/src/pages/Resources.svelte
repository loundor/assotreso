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
  let editingItem: (Category | Project) | null = null;

  // Champs de formulaire
  let name = '';
  let description = '';
  let budget = 0;
  let color = '#3b8068';
  let parentId = '';
  let projectId = '';
  let categoryKind: 'RECETTE' | 'DEPENSE' | 'MIXTE' = 'DEPENSE';
  let projectStatus: 'IDEE' | 'MONTAGE' | 'EN_COURS' | 'TERMINE' | 'AVORTE' = 'EN_COURS';
  let projectStatusReason = '';

  $: isProject = kind === 'projects';
  $: title = isProject ? 'Projets' : 'Catégories et rubriques';
  $: availableCategoryParents = (items as Category[]).filter((item) =>
    (item.kind ?? 'DEPENSE') === categoryKind &&
    String(item.projectId ?? item.project_id ?? '') === projectId &&
    (!editingItem || String(item.id) !== String(editingItem.id))
  );
  $: displayItems = hierarchy(items);

  interface CategoryNode {
    category: Category;
    depth: number;
    children: CategoryNode[];
  }

  interface CategoryDomainSection {
    id: 'RECETTE' | 'DEPENSE' | 'MIXTE' | 'PROJET';
    title: string;
    description: string;
    icon: 'transfer' | 'wallet' | 'tag' | 'folder';
    color: string;
    roots: CategoryNode[];
    totalCount: number;
  }

  let selectedCategoryFilter: 'ALL' | 'RECETTE' | 'DEPENSE' | 'MIXTE' | 'PROJET' = 'ALL';

  $: categoryDomainSections = (() => {
    if (isProject) return [] as CategoryDomainSection[];
    const allCategories = items as Category[];

    const catMap = new Map<string, Category>();
    for (const c of allCategories) {
      catMap.set(String(c.id), c);
    }

    const childrenMap = new Map<string, Category[]>();
    for (const c of allCategories) {
      const pid = String(c.parentId ?? c.parent_id ?? '');
      if (pid && catMap.has(pid)) {
        childrenMap.set(pid, [...(childrenMap.get(pid) ?? []), c]);
      }
    }

    const visited = new Set<string>();

    function buildNode(c: Category, depth: number): CategoryNode {
      visited.add(String(c.id));
      const directChildren = (childrenMap.get(String(c.id)) ?? [])
        .filter((child) => !visited.has(String(child.id)))
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

      const childrenNodes: CategoryNode[] = directChildren.map((child) => buildNode(child, depth + 1));
      return {
        category: c,
        depth,
        children: childrenNodes
      };
    }

    function countNodes(node: CategoryNode): number {
      return 1 + node.children.reduce((acc, ch) => acc + countNodes(ch), 0);
    }

    const isProjectCat = (c: Category) => Boolean(c.projectId || c.project_id);

    const filterList = (predicate: (c: Category) => boolean): CategoryNode[] => {
      const domainCategories = allCategories.filter(predicate);
      const domainMap = new Map<string, Category>();
      for (const c of domainCategories) domainMap.set(String(c.id), c);

      const roots = domainCategories.filter((c) => {
        const pid = String(c.parentId ?? c.parent_id ?? '');
        return (!pid || !domainMap.has(pid)) && !visited.has(String(c.id));
      });
      roots.sort((a, b) => a.name.localeCompare(b.name, 'fr'));

      return roots.map((r) => buildNode(r, 0));
    };

    const sections: CategoryDomainSection[] = [];

    // 1. Entrées (Recettes)
    const recettesRoots = filterList((c) => !isProjectCat(c) && (c.kind ?? 'DEPENSE') === 'RECETTE');
    if (recettesRoots.length > 0) {
      sections.push({
        id: 'RECETTE',
        title: 'Entrées (Recettes)',
        description: 'Ressources financières, cotisations, subventions, dons et ventes',
        icon: 'transfer',
        color: '#16a34a',
        roots: recettesRoots,
        totalCount: recettesRoots.reduce((acc, n) => acc + countNodes(n), 0)
      });
    }

    // 2. Sorties (Dépenses)
    const depensesRoots = filterList((c) => !isProjectCat(c) && (c.kind ?? 'DEPENSE') === 'DEPENSE');
    if (depensesRoots.length > 0) {
      sections.push({
        id: 'DEPENSE',
        title: 'Sorties (Dépenses)',
        description: 'Charges courantes, achats, fournitures, prestations et frais de fonctionnement',
        icon: 'wallet',
        color: '#e76f51',
        roots: depensesRoots,
        totalCount: depensesRoots.reduce((acc, n) => acc + countNodes(n), 0)
      });
    }

    // 3. Mixtes
    const mixtesRoots = filterList((c) => !isProjectCat(c) && (c.kind ?? 'DEPENSE') === 'MIXTE');
    if (mixtesRoots.length > 0) {
      sections.push({
        id: 'MIXTE',
        title: 'Catégories Mixtes',
        description: 'Rubriques regroupant des encaissements et des décaissements équilibrés',
        icon: 'tag',
        color: '#0284c7',
        roots: mixtesRoots,
        totalCount: mixtesRoots.reduce((acc, n) => acc + countNodes(n), 0)
      });
    }

    // 4. Par Projet
    const projectRoots = filterList((c) => isProjectCat(c));
    if (projectRoots.length > 0) {
      sections.push({
        id: 'PROJET',
        title: 'Catégories par Projet',
        description: 'Rubriques d’imputation budgétaire dédiées à des projets spécifiques',
        icon: 'folder',
        color: '#7c3aed',
        roots: projectRoots,
        totalCount: projectRoots.reduce((acc, n) => acc + countNodes(n), 0)
      });
    }

    return sections;
  })();

  const STATUS_ORDER: Array<'EN_COURS' | 'MONTAGE' | 'IDEE' | 'TERMINE' | 'AVORTE'> = [
    'EN_COURS',
    'MONTAGE',
    'IDEE',
    'TERMINE',
    'AVORTE'
  ];

  interface ProjectNode {
    project: Project;
    depth: number;
    children: ProjectNode[];
  }

  interface ProjectStatusGroup {
    status: 'EN_COURS' | 'MONTAGE' | 'IDEE' | 'TERMINE' | 'AVORTE';
    meta: { label: string; color: string; bg: string };
    roots: ProjectNode[];
    totalCount: number;
  }

  let selectedProjectFilter: 'ALL' | 'EN_COURS' | 'MONTAGE' | 'IDEE' | 'TERMINE' | 'AVORTE' = 'ALL';

  function countProjectNodes(node: ProjectNode): number {
    return 1 + node.children.reduce((acc, ch) => acc + countProjectNodes(ch), 0);
  }

  function treeContainsStatus(node: ProjectNode, status: string): boolean {
    if ((node.project.status ?? 'EN_COURS') === status) return true;
    return node.children.some((ch) => treeContainsStatus(ch, status));
  }

  function groupMatchesFilter(group: ProjectStatusGroup, filter: string): boolean {
    if (filter === 'ALL') return true;
    if (group.status === filter) return true;
    return group.roots.some((r) => treeContainsStatus(r, filter));
  }

  $: projectStatusGroups = (() => {
    if (!isProject) return [] as ProjectStatusGroup[];
    const allProjects = items as Project[];

    const projMap = new Map<string, Project>();
    for (const p of allProjects) {
      projMap.set(String(p.id), p);
    }

    const childrenMap = new Map<string, Project[]>();
    for (const p of allProjects) {
      const pid = String(p.parentId ?? p.parent_id ?? '');
      if (pid && projMap.has(pid)) {
        childrenMap.set(pid, [...(childrenMap.get(pid) ?? []), p]);
      }
    }

    const visited = new Set<string>();

    function buildProjectNode(p: Project, depth: number): ProjectNode {
      visited.add(String(p.id));
      const directChildren = (childrenMap.get(String(p.id)) ?? [])
        .filter((child) => !visited.has(String(child.id)))
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

      const childrenNodes: ProjectNode[] = directChildren.map((child) => buildProjectNode(child, depth + 1));
      return {
        project: p,
        depth,
        children: childrenNodes
      };
    }

    // Identifie les projets racines (sans parent existant dans la liste)
    const rootProjects = allProjects.filter((p) => {
      const pid = String(p.parentId ?? p.parent_id ?? '');
      return (!pid || !projMap.has(pid)) && !visited.has(String(p.id));
    });

    const groups: ProjectStatusGroup[] = [];

    for (const status of STATUS_ORDER) {
      const meta = statusMeta(status);
      const rootsForStatus = rootProjects
        .filter((p) => (p.status ?? 'EN_COURS') === status)
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

      const rootNodes = rootsForStatus.map((r) => buildProjectNode(r, 0));
      const totalCount = rootNodes.reduce((acc, n) => acc + countProjectNodes(n), 0);

      if (rootNodes.length > 0) {
        groups.push({
          status,
          meta,
          roots: rootNodes,
          totalCount
        });
      }
    }

    // Gestion de sécurité : si des projets isolés ou orphelins restent non visités, les regrouper sans doublon
    const unvisited = allProjects.filter((p) => !visited.has(String(p.id)));
    if (unvisited.length > 0) {
      for (const unv of unvisited) {
        if (!visited.has(String(unv.id))) {
          const node = buildProjectNode(unv, 0);
          const st = (unv.status ?? 'EN_COURS') as 'EN_COURS' | 'MONTAGE' | 'IDEE' | 'TERMINE' | 'AVORTE';
          let existingGroup = groups.find((g) => g.status === st);
          if (!existingGroup) {
            existingGroup = {
              status: st,
              meta: statusMeta(st),
              roots: [],
              totalCount: 0
            };
            groups.push(existingGroup);
          }
          existingGroup.roots.push(node);
          existingGroup.totalCount += countProjectNodes(node);
        }
      }
    }

    return groups;
  })();

  function startAddChildCategory(parent: Category) {
    resetForm();
    categoryKind = (parent.kind as 'RECETTE' | 'DEPENSE' | 'MIXTE') || 'DEPENSE';
    projectId = String(parent.projectId ?? parent.project_id ?? '');
    parentId = String(parent.id);
    color = parent.color || '#3b8068';
    formOpen = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function startAddChildProject(parent: Project) {
    resetForm();
    parentId = String(parent.id);
    projectStatus = (parent.status as 'IDEE' | 'MONTAGE' | 'EN_COURS' | 'TERMINE' | 'AVORTE') || 'EN_COURS';
    formOpen = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function startAddProjectWithStatus(status: 'IDEE' | 'MONTAGE' | 'EN_COURS' | 'TERMINE' | 'AVORTE') {
    resetForm();
    projectStatus = status;
    formOpen = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function statusMeta(s?: string) {
    switch (s) {
      case 'IDEE': return { label: '💡 Idée', color: '#7c3aed', bg: '#f5f3ff' };
      case 'MONTAGE': return { label: '📋 Montage', color: '#0284c7', bg: '#f0f9ff' };
      case 'EN_COURS': return { label: '🚀 En cours', color: '#16a34a', bg: '#f0fdf4' };
      case 'TERMINE': return { label: '✅ Terminé', color: '#059669', bg: '#ecfdf5' };
      case 'AVORTE': return { label: '⏹️ Avorté', color: '#dc2626', bg: '#fef2f2' };
      default: return { label: '🚀 En cours', color: '#16a34a', bg: '#f0fdf4' };
    }
  }

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
    editingItem = null;
    name = '';
    description = '';
    budget = 0;
    color = '#3b8068';
    parentId = '';
    projectId = '';
    categoryKind = 'DEPENSE';
    projectStatus = 'EN_COURS';
    projectStatusReason = '';
    formError = '';
  }

  function startEdit(item: Category | Project) {
    editingItem = item;
    name = item.name;
    formError = '';
    if (isProject) {
      const p = item as Project;
      description = p.description || '';
      budget = Number(p.budget) || 0;
      parentId = String(p.parentId ?? p.parent_id ?? '');
      projectStatus = (p.status || 'EN_COURS') as 'IDEE' | 'MONTAGE' | 'EN_COURS' | 'TERMINE' | 'AVORTE';
      projectStatusReason = p.status_reason || p.statusReason || '';
    } else {
      const c = item as Category;
      categoryKind = (c.kind || 'DEPENSE') as 'RECETTE' | 'DEPENSE' | 'MIXTE';
      color = c.color || '#3b8068';
      projectId = String(c.projectId ?? c.project_id ?? '');
      parentId = String(c.parentId ?? c.parent_id ?? '');
    }
    formOpen = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
      const payload = isProject
        ? {
            name,
            description,
            budget: Number(budget),
            parentId: parentId || null,
            status: projectStatus,
            statusReason: projectStatusReason.trim() || null,
            active: true
          }
        : {
            name,
            kind: categoryKind,
            color,
            projectId: projectId || null,
            parentId: parentId || null
          };

      if (editingItem) {
        await api.put(`${kind}/${editingItem.id}`, payload);
      } else {
        await api.post(kind, payload);
      }
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
      <Icon name={formOpen ? 'close' : 'plus'} size={18}/>{formOpen ? 'Fermer le formulaire' : `Ajouter ${isProject ? 'un projet' : 'une rubrique'}`}
    </button>
  </div>

  {#if formOpen}
    <form class="panel inline-form" on:submit|preventDefault={save}>
      <div class="form-heading">
        <h3>{editingItem ? `Modifier : ${editingItem.name}` : (isProject ? 'Nouveau projet' : 'Nouvelle catégorie ou rubrique')}</h3>
        <p>{isProject ? 'Un projet parent transforme ce projet en sous-projet.' : 'Choisissez un projet pour créer une rubrique dédiée, ou laissez vide pour une catégorie globale.'}</p>
      </div>
      {#if formError}<div class="alert" role="alert">{formError}</div>{/if}
      <div class="form-grid">
        <label>Nom<input bind:value={name} required placeholder={isProject ? 'Festival annuel' : 'Télécommunications'}/></label>
        {#if isProject}
          <label>Projet parent
            <select bind:value={parentId}>
              <option value="">Aucun — projet principal</option>
              {#each hierarchy(projects.filter((p) => !editingItem || String(p.id) !== String(editingItem.id))) as project}
                <option value={project.id}>{'— '.repeat(project.depth)}{project.name}</option>
              {/each}
            </select>
          </label>
          <label>Statut du projet
            <select bind:value={projectStatus}>
              <option value="IDEE">💡 Idée</option>
              <option value="MONTAGE">📋 Montage</option>
              <option value="EN_COURS">🚀 En cours</option>
              <option value="TERMINE">✅ Terminé</option>
              <option value="AVORTE">⏹️ Avorté</option>
            </select>
          </label>
          <label>Budget prévisionnel (€)<input type="number" min="0" step="0.01" bind:value={budget}/></label>
          <label class="span-2">Raison / Commentaire sur le statut
            <input bind:value={projectStatusReason} placeholder="Ex. En recherche de financements, suspendu, validé..." />
          </label>
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
      <div class="form-actions config-actions">
        {#if editingItem}
          <button type="button" class="btn btn-secondary" on:click={() => { resetForm(); formOpen = false; }}>Annuler</button>
        {/if}
        <button class="btn btn-primary" disabled={saving}>
          {saving ? 'Enregistrement…' : editingItem ? 'Enregistrer les modifications' : 'Créer'}
        </button>
      </div>
    </form>
  {/if}

  <AsyncState {loading} {error} empty={!items.length} emptyTitle={`Aucun${isProject ? ' projet' : 'e catégorie'}`} emptyText={`Créez ${isProject ? 'un premier projet' : 'une première catégorie'} pour organiser votre trésorerie.`} onRetry={load}>
    {#if !isProject}
      {#snippet renderCategoryNode(node: CategoryNode)}
        <div class="category-node-wrap" style:margin-left={`${Math.min(node.depth, 4) * 20}px`}>
          <article
            class="panel resource-card"
            class:root-card={node.depth === 0}
            class:sub-card={node.depth > 0}
            style:border-left={`4px solid ${node.category.color || '#3b8068'}`}
          >
            <div class="resource-header-row">
              <span
                class="resource-icon"
                style:background={`${node.category.color || '#3b8068'}20`}
                style:color={node.category.color || '#3b8068'}
              >
                <Icon name="tag" size={18}/>
              </span>
              <div class="resource-badges-line">
                {#if node.depth === 0}
                  <span class="soft-badge main-badge">Catégorie racine</span>
                {:else}
                  <span class="soft-badge child-badge">Sous-rubrique {node.depth > 1 ? `Niv. ${node.depth + 1}` : ''}</span>
                {/if}
                <span class="soft-badge">{node.category.kind || 'DEPENSE'}</span>
                {#if node.category.project_name}
                  <span class="project-tag">📁 {node.category.project_name}</span>
                {/if}
                {#if node.children.length > 0}
                  <span class="sub-count-tag">{node.children.length} sous-rubrique{node.children.length > 1 ? 's' : ''}</span>
                {/if}
              </div>
              <div class="card-actions-row">
                <button
                  type="button"
                  class="btn btn-secondary btn-mini"
                  title="Ajouter une sous-rubrique"
                  on:click={() => startAddChildCategory(node.category)}
                >
                  <Icon name="plus" size={12}/>
                </button>
                <button
                  type="button"
                  class="icon-button edit-resource-btn"
                  title={`Modifier ${node.category.name}`}
                  aria-label={`Modifier ${node.category.name}`}
                  on:click={() => startEdit(node.category)}
                >
                  <Icon name="edit" size={16}/>
                </button>
              </div>
            </div>

            <div class="resource-body">
              <div class="resource-title-line">
                <h4>{node.category.name}</h4>
              </div>
              {#if node.category.project_name}
                <p><small>Liée au projet <strong>{node.category.project_name}</strong></small></p>
              {/if}
            </div>
          </article>

          <!-- Recursive sub-categories inside sub-categories (sans doublons) -->
          {#if node.children.length > 0}
            <div class="category-children-container">
              {#each node.children as child (child.category.id)}
                {@render renderCategoryNode(child)}
              {/each}
            </div>
          {/if}
        </div>
      {/snippet}

      <!-- GROUPED BY: Entrée, Sortie, Mixte, Projet -->
      <div class="category-domain-filters">
        <button
          type="button"
          class="filter-chip"
          class:active={selectedCategoryFilter === 'ALL'}
          on:click={() => selectedCategoryFilter = 'ALL'}
        >
          Toutes ({items.length})
        </button>
        <button
          type="button"
          class="filter-chip"
          class:active={selectedCategoryFilter === 'RECETTE'}
          on:click={() => selectedCategoryFilter = 'RECETTE'}
        >
          📥 Entrées (Recettes)
        </button>
        <button
          type="button"
          class="filter-chip"
          class:active={selectedCategoryFilter === 'DEPENSE'}
          on:click={() => selectedCategoryFilter = 'DEPENSE'}
        >
          📤 Sorties (Dépenses)
        </button>
        <button
          type="button"
          class="filter-chip"
          class:active={selectedCategoryFilter === 'MIXTE'}
          on:click={() => selectedCategoryFilter = 'MIXTE'}
        >
          🔄 Mixtes
        </button>
        <button
          type="button"
          class="filter-chip"
          class:active={selectedCategoryFilter === 'PROJET'}
          on:click={() => selectedCategoryFilter = 'PROJET'}
        >
          📁 Par Projet
        </button>
      </div>

      <div class="domain-sections-stack">
        {#each categoryDomainSections.filter((s) => selectedCategoryFilter === 'ALL' || selectedCategoryFilter === s.id) as section (section.id)}
          <section class="category-domain-section">
            <div class="category-domain-header" style:border-left={`5px solid ${section.color}`}>
              <div class="domain-header-left">
                <span class="domain-icon-box" style:background={`${section.color}15`} style:color={section.color}>
                  <Icon name={section.icon} size={22}/>
                </span>
                <div>
                  <h3 class="domain-title">{section.title}</h3>
                  <p class="domain-desc">{section.description}</p>
                </div>
              </div>
              <span class="domain-count-badge">{section.totalCount} catégorie{section.totalCount > 1 ? 's' : ''}</span>
            </div>

            <div class="category-roots-list">
              {#each section.roots as rootNode (rootNode.category.id)}
                <div class="category-root-group">
                  {@render renderCategoryNode(rootNode)}
                </div>
              {/each}
            </div>
          </section>
        {/each}
      </div>
    {:else}
      {#snippet renderProjectNode(node: ProjectNode)}
        {@const pMeta = statusMeta(node.project.status)}
        <div class="project-node-wrap" style:margin-left={`${Math.min(node.depth, 4) * 20}px`}>
          <article
            class="panel resource-card project-card"
            class:root-card={node.depth === 0}
            class:sub-card={node.depth > 0}
            style:border-left={`4px solid ${pMeta.color}`}
          >
            <div class="resource-header-row">
              <span
                class="resource-icon"
                style:background={`${pMeta.color}18`}
                style:color={pMeta.color}
              >
                <Icon name="folder" size={18}/>
              </span>
              <div class="resource-badges-line">
                {#if node.depth === 0}
                  <span class="soft-badge main-badge">Projet principal</span>
                {:else}
                  <span class="soft-badge child-badge">Sous-projet {node.depth > 1 ? `Niv. ${node.depth + 1}` : ''}</span>
                {/if}

                <span
                  class="status-badge-custom"
                  style:background={pMeta.bg}
                  style:color={pMeta.color}
                  style:border={`1px solid ${pMeta.color}40`}
                >
                  {pMeta.label}
                </span>

                {#if node.children.length > 0}
                  <span class="sub-count-tag">
                    {node.children.length} sous-projet{node.children.length > 1 ? 's' : ''}
                  </span>
                {/if}
              </div>

              <div class="card-actions-row">
                <button
                  type="button"
                  class="btn btn-secondary btn-mini"
                  title="Ajouter un sous-projet sous ce projet"
                  on:click={() => startAddChildProject(node.project)}
                >
                  <Icon name="plus" size={12}/>
                </button>
                <button
                  type="button"
                  class="icon-button edit-resource-btn"
                  title={`Modifier ${node.project.name}`}
                  aria-label={`Modifier ${node.project.name}`}
                  on:click={() => startEdit(node.project)}
                >
                  <Icon name="edit" size={16}/>
                </button>
              </div>
            </div>

            <div class="resource-body">
              <div class="resource-title-line">
                <h4>{node.project.name}</h4>
              </div>
              {#if node.project.description}
                <p class="resource-desc">{node.project.description}</p>
              {/if}
              {#if node.project.status_reason || node.project.statusReason}
                <div class="status-reason-box">
                  <small>💬 {node.project.status_reason || node.project.statusReason}</small>
                </div>
              {/if}
            </div>

            {#if 'budget' in node.project && (node.project.budget || node.project.expense)}
              <div class="resource-meta">
                <span>Budget prévisionnel</span>
                <strong>{currency.format(node.project.budget ?? 0)}</strong>
                {#if node.project.expense}
                  <small>{currency.format(node.project.expense ?? 0)} dépensés</small>
                {/if}
              </div>
            {/if}
          </article>

          <!-- Recursive sub-projects inside sub-projects (sans doublons) -->
          {#if node.children.length > 0}
            <div class="project-children-container">
              {#each node.children as child (child.project.id)}
                {@render renderProjectNode(child)}
              {/each}
            </div>
          {/if}
        </div>
      {/snippet}

      <!-- FILTRES DE STATUT DES PROJETS -->
      <div class="category-domain-filters">
        <button
          type="button"
          class="filter-chip"
          class:active={selectedProjectFilter === 'ALL'}
          on:click={() => selectedProjectFilter = 'ALL'}
        >
          Tous ({items.length})
        </button>
        <button
          type="button"
          class="filter-chip"
          class:active={selectedProjectFilter === 'EN_COURS'}
          on:click={() => selectedProjectFilter = 'EN_COURS'}
        >
          🚀 En cours
        </button>
        <button
          type="button"
          class="filter-chip"
          class:active={selectedProjectFilter === 'MONTAGE'}
          on:click={() => selectedProjectFilter = 'MONTAGE'}
        >
          📋 Montage
        </button>
        <button
          type="button"
          class="filter-chip"
          class:active={selectedProjectFilter === 'IDEE'}
          on:click={() => selectedProjectFilter = 'IDEE'}
        >
          💡 Idée
        </button>
        <button
          type="button"
          class="filter-chip"
          class:active={selectedProjectFilter === 'TERMINE'}
          on:click={() => selectedProjectFilter = 'TERMINE'}
        >
          ✅ Terminé
        </button>
        <button
          type="button"
          class="filter-chip"
          class:active={selectedProjectFilter === 'AVORTE'}
          on:click={() => selectedProjectFilter = 'AVORTE'}
        >
          ⏹️ Avorté
        </button>
      </div>

      <!-- PROJETS GROUPÉS PAR STATUT AVEC SOUS-PROJETS REGROUPÉS SANS DOUBLONS -->
      <div class="groups-stack">
        {#each projectStatusGroups.filter((g) => groupMatchesFilter(g, selectedProjectFilter)) as group (group.status)}
          <section class="resource-group-section">
            <div class="resource-group-header" style:border-left={`5px solid ${group.meta.color}`}>
              <div class="resource-group-title-wrap">
                <span class="status-badge-custom status-header-badge" style:background={group.meta.bg} style:color={group.meta.color} style:border={`1px solid ${group.meta.color}40`}>
                  {group.meta.label}
                </span>
                <span class="group-count-badge">
                  {group.totalCount} projet{group.totalCount > 1 ? 's' : ''} au total ({group.roots.length} principal{group.roots.length > 1 ? 'aux' : ''})
                </span>
              </div>
              <div class="group-header-actions">
                <button
                  type="button"
                  class="btn btn-secondary btn-small"
                  on:click={() => startAddProjectWithStatus(group.status)}
                >
                  <Icon name="plus" size={14}/> Ajouter un projet
                </button>
              </div>
            </div>

            <div class="project-roots-list">
              {#each group.roots as rootNode (rootNode.project.id)}
                <div class="project-root-group">
                  {@render renderProjectNode(rootNode)}
                </div>
              {/each}
            </div>
          </section>
        {/each}
      </div>
    {/if}
  </AsyncState>
</div>

<style>
  .resource-header-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.6rem;
  }
  .resource-badges-line {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
    flex: 1;
  }
  .status-badge-custom {
    display: inline-flex;
    align-items: center;
    padding: 0.2rem 0.55rem;
    border-radius: 99px;
    font-size: 0.75rem;
    font-weight: 700;
  }
  .edit-resource-btn {
    color: var(--muted);
    padding: 0.35rem;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: white;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .edit-resource-btn:hover {
    color: var(--green);
    border-color: var(--green-3);
    background: var(--green-soft);
  }
  .resource-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .resource-desc {
    font-size: 0.86rem;
    color: var(--muted);
    line-height: 1.4;
  }
  .status-reason-box {
    background: #f8faf9;
    border-left: 3px solid var(--green-3);
    padding: 0.3rem 0.6rem;
    border-radius: 4px;
    margin: 0.2rem 0;
  }
  .status-reason-box small {
    color: #4a6358;
    font-style: italic;
  }
  .groups-stack {
    display: flex;
    flex-direction: column;
    gap: 2.2rem;
  }
  .resource-group-section {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }
  .resource-group-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding-bottom: 0.65rem;
    border-bottom: 2px solid var(--line);
    flex-wrap: wrap;
  }
  .resource-group-title-wrap {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    flex-wrap: wrap;
  }
  .project-tag {
    font-size: 0.78rem;
    color: var(--muted);
    background: #f0f4f2;
    padding: 0.2rem 0.5rem;
    border-radius: 6px;
  }
  .group-count-badge {
    font-size: 0.78rem;
    color: var(--muted);
    font-weight: 500;
  }
  .group-header-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .main-badge {
    background: var(--green-soft);
    color: var(--green);
    font-weight: 600;
  }
  .child-badge {
    background: #f3f4f6;
    color: #4b5563;
  }
  .card-actions-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .btn-mini {
    padding: 0.25rem 0.45rem;
    font-size: 0.75rem;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .sub-count-tag {
    font-size: 0.72rem;
    color: var(--muted);
    font-weight: 600;
    background: #f0fdf4;
    color: var(--green);
    padding: 0.15rem 0.45rem;
    border-radius: 4px;
    border: 1px solid #bbf7d0;
  }
  .category-domain-filters {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-bottom: 1.25rem;
  }
  .filter-chip {
    background: white;
    border: 1px solid var(--line);
    border-radius: 99px;
    padding: 0.4rem 0.9rem;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--ink);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .filter-chip:hover {
    border-color: var(--green);
    background: #fbfdfc;
  }
  .filter-chip.active {
    background: var(--green);
    border-color: var(--green);
    color: white;
  }
  .domain-sections-stack {
    display: flex;
    flex-direction: column;
    gap: 2.5rem;
  }
  .category-domain-section {
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
  }
  .category-domain-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem 1.1rem;
    background: #f8faf9;
    border: 1px solid #dce5df;
    border-radius: 10px;
    flex-wrap: wrap;
  }
  .domain-header-left {
    display: flex;
    align-items: center;
    gap: 0.85rem;
  }
  .domain-icon-box {
    width: 38px;
    height: 38px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .domain-title {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 800;
    color: var(--ink);
  }
  .domain-desc {
    margin: 0.15rem 0 0 0;
    font-size: 0.8rem;
    color: var(--muted);
  }
  .domain-count-badge {
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--ink);
    background: white;
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--line);
    border-radius: 99px;
  }
  .category-roots-list {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .category-root-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .category-node-wrap {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 0.35rem;
  }
  .category-children-container {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-top: 0.2rem;
    border-left: 2px dashed #d1ded7;
    padding-left: 0.5rem;
  }
  .root-card {
    background: #fcfdfc;
  }
  .sub-card {
    background: white;
  }

  /* Hiérarchie arborescente des projets et sous-projets */
  .project-roots-list {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .project-root-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .project-node-wrap {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 0.35rem;
  }
  .project-children-container {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    margin-top: 0.25rem;
    border-left: 2px dashed #93c5fd;
    padding-left: 0.65rem;
  }
  .project-card {
    transition: box-shadow 0.15s ease, border-color 0.15s ease;
  }
  .project-card.sub-card {
    background: #fbfcfe;
  }
</style>
