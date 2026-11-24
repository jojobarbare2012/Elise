// Stockage sur disque : un seul fichier JSON lisible + une copie .bak + une sauvegarde par jour.
// Écriture atomique (fichier temporaire puis renommage) et révision pour détecter les conflits.
import { copyFile, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

const GARDER_SAUVEGARDES = 30

const dateLocale = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function creerStockage(dossier) {
  const fichier = path.join(dossier, 'atelier.json')
  const dossierSauvegardes = path.join(dossier, 'sauvegardes')
  let file = Promise.resolve() // une seule écriture à la fois

  async function lire() {
    for (const candidat of [fichier, fichier + '.bak']) {
      try {
        const doc = JSON.parse(await readFile(candidat, 'utf8'))
        if (doc && typeof doc.revision === 'number' && doc.donnees) return doc
      } catch (e) {
        if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e
      }
    }
    return null
  }

  async function sauvegardeDuJour() {
    await mkdir(dossierSauvegardes, { recursive: true })
    try {
      await copyFile(fichier, path.join(dossierSauvegardes, `atelier-${dateLocale()}.json`), 1) // 1 = ne pas écraser
    } catch (e) {
      if (e.code !== 'EEXIST' && e.code !== 'ENOENT') throw e
    }
    const anciennes = (await readdir(dossierSauvegardes)).filter((n) => /^atelier-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort()
    for (const nom of anciennes.slice(0, Math.max(0, anciennes.length - GARDER_SAUVEGARDES))) {
      await unlink(path.join(dossierSauvegardes, nom))
    }
  }

  /** Écrit `donnees` si `base` est bien la révision actuelle ; sinon signale le conflit. */
  function ecrire(base, donnees) {
    const tache = file.then(async () => {
      const actuel = await lire()
      const revisionActuelle = actuel?.revision ?? 0
      if (base !== revisionActuelle) return { conflit: true, revision: revisionActuelle }
      await mkdir(dossier, { recursive: true })
      if (actuel) {
        await sauvegardeDuJour()
        await copyFile(fichier, fichier + '.bak')
      }
      const doc = { format: 1, revision: revisionActuelle + 1, modifieLe: Date.now(), donnees }
      const temporaire = fichier + '.tmp'
      await writeFile(temporaire, JSON.stringify(doc, null, 1), 'utf8')
      await rename(temporaire, fichier)
      return { conflit: false, revision: doc.revision }
    })
    file = tache.catch(() => {})
    return tache
  }

  return { lire, ecrire, dossier, fichier }
}
