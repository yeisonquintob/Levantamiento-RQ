import Link from "next/link";

import styles from "./not-found.module.css";

export default function NotFound() {
  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="not-found-title">
        <p className={styles.code}>404</p>
        <h1 id="not-found-title" className={styles.title}>
          Página no encontrada
        </h1>
        <p className={styles.text}>
          La dirección que intentaste abrir no existe o ya no está disponible.
        </p>
        <Link href="/" className={styles.link}>
          Volver al inicio
        </Link>
      </section>
    </main>
  );
}
