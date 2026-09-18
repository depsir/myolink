import { afterEach, describe, expect, it, vi } from "vitest";
import { MIC, elencoMic, micAperto, micChiuso, scegliMic, vincoloMic } from "../src/audio/microfoni.js";

// La lista come la restituisce il browser: `enumerateDevices` mescola ingressi,
// uscite e videocamere, e in Chrome ci mette anche due voci che non sono
// dispositivi.
const dev = (deviceId, label, kind = "audioinput") => ({ deviceId, label, kind });

const browser = (lista) => vi.stubGlobal("navigator", {
  mediaDevices: { enumerateDevices: async () => lista },
});

afterEach(() => { vi.unstubAllGlobals(); scegliMic(""); micChiuso(); });

describe("la scelta del microfono", () => {
  it("senza preferenza non vincola niente", () => {
    expect(vincoloMic()).toEqual({});
  });

  // `exact` e non `ideal`: `ideal` è un desiderio, e il browser lo scavalca col
  // dispositivo che si è ricordato per il sito — cioè la sorgente non cambia,
  // che è l'unica cosa che questo comando deve saper fare. Il ripiego quando
  // quel dispositivo non c'è lo fa `audio.js`, riaprendo senza vincoli.
  it("chiede il dispositivo scelto come obbligo, non come desiderio", () => {
    scegliMic("abc");
    expect(vincoloMic()).toEqual({ deviceId: { exact: "abc" } });
  });

  // Il nome resta accanto all'id perché è tutto ciò che si può mostrare quando
  // quel dispositivo non è attaccato: è la voce spenta della tendina.
  it("ricorda anche il nome del dispositivo scelto", () => {
    scegliMic("abc", "Scarlett Solo USB");
    expect(MIC).toMatchObject({ scelto: "abc", nome: "Scarlett Solo USB" });
    scegliMic("");
    expect(MIC).toMatchObject({ scelto: "", nome: "" });
  });

  it("legge dalla traccia viva quale dispositivo è entrato davvero", () => {
    const stream = (deviceId) => ({ getAudioTracks: () => [{ getSettings: () => ({ deviceId }) }] });
    expect(micAperto(stream("abc"))).toBe("abc");
    // Gli alias di Chrome sono il predefinito di sistema con un altro nome, cioè
    // esattamente ciò che qui si scrive "".
    expect(micAperto(stream("default"))).toBe("");
    expect(micAperto(stream("communications"))).toBe("");
    // Un browser che non espone `getSettings` non è un errore: è nessuna notizia.
    expect(micAperto({ getAudioTracks: () => [{}] })).toBe("");
    expect(micAperto(null)).toBe("");
    expect(MIC.aperto).toBe("");
  });
});

describe("l'elenco degli ingressi audio", () => {
  it("tiene solo i microfoni, senza gli alias di Chrome", async () => {
    browser([
      dev("default", "Predefinito - Microfono MacBook Pro"),
      dev("communications", "Comunicazioni - Microfono MacBook Pro"),
      dev("aaa", "Microfono MacBook Pro"),
      dev("bbb", "Scarlett Solo USB"),
      dev("ccc", "Altoparlanti", "audiooutput"),
      dev("ddd", "FaceTime HD", "videoinput"),
    ]);
    expect(await elencoMic()).toEqual([
      { id: "aaa", nome: "Microfono MacBook Pro" },
      { id: "bbb", nome: "Scarlett Solo USB" },
    ]);
  });

  // È il caso "permesso non ancora dato": i dispositivi ci sono ma non hanno un
  // nome, e una tendina di tre voci vuote non è una scelta.
  it("non elenca niente finché le etichette sono vuote", async () => {
    browser([dev("aaa", ""), dev("bbb", "")]);
    expect(await elencoMic()).toEqual([]);
  });

  it("non elenca niente dove l'API non c'è o fallisce", async () => {
    vi.stubGlobal("navigator", {});
    expect(await elencoMic()).toEqual([]);
    vi.stubGlobal("navigator", {
      mediaDevices: { enumerateDevices: async () => { throw new Error("no"); } },
    });
    expect(await elencoMic()).toEqual([]);
  });
});
