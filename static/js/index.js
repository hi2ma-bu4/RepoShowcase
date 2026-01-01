const libraries = [
	{
		name: "JavaLibraryScript",
		description: "JavaScriptでJavaっぽい機能を提供するライブラリ。",
		github: "JavaLibraryScript",
	},
	{
		name: "WinLet",
		description: "ウィンドウUIライブラリ。",
		github: "winlet",
	},
	{
		name: "SnowFall",
		description: "独自言語『SnowFall』のコンパイル、実行環境を提供する。",
		github: "SnowFall",
	},
	{
		name: "SnowFall2",
		description: "独自言語『SnowFall』をRustで1から再設計したライブラリ。",
		github: "SnowFall2",
	},
	{
		name: "FlowKeys",
		description: "キー入力で(コナミコマンドとかの)コマンド判定が出来るやつ",
		github: "FlowKeys",
	},
	{
		name: "PseudoDebugKit",
		description: "疑似的なdevtoolsの機能が使えるライブラリ(お遊び用)。",
		github: "PseudoDebugKit",
	},
];

jasc.on("DOMContentLoaded", () => {
	const list = document.getElementById("library-list");

	libraries.forEach((lib) => {
		const card = document.createElement("div");
		card.className = "library-card";

		card.innerHTML = `
		<h2>${lib.name}</h2>
		<p>${lib.description}</p>
		<div class="card-links">
			<a href="https://github.com/hi2ma-bu4/${lib.github}" target="_blank">GitHub</a>
			<a href="https://hi2ma-bu4.github.io/RepoShowcase/public/${lib.github.toLowerCase()}/test/">デモ</a>
		</div>
	`;

		list.appendChild(card);
	});
});
