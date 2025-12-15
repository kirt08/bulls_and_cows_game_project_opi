// --- Элементы страницы 1 ---
const page1 = document.querySelector(".page_1");
const createRoomBtn = document.querySelector(".page_1_button_create_room");
const connectRoomBtn = document.querySelector(".page_1_button_connect_to_existing_room");
const form = document.querySelector(".page_1_form_connection");
const inputRoomId = document.getElementById("InputRoomId");
const roomError = document.getElementById("roomError");

// --- Элементы страницы 2 ---
const page2 = document.querySelector(".page_2");
const roomHeader = document.querySelector(".page_2_header_for_roomid");
const messagesUl = document.getElementById("messages");
const messageInput = document.getElementById("messageText");
const sendBtn = document.getElementById("send_message");
const cancelBtn = document.querySelector(".page_2_cancel_button");

document.addEventListener("DOMContentLoaded", () => {
    const page3 = document.querySelector(".page_3");
    const backToMenuBtn = document.querySelector(".page_3_back_button");
    const recordsTableBody = document.getElementById("records_table_body");

    const showRecordsBtn = document.querySelector(".page_1_button_show_records");
    showRecordsBtn.addEventListener("click", () => {
        fetchRecords();
        page1.style.display = "none";
        page2.style.display = "none";
        page3.style.display = "flex";
    });
    function showRecordsPage(records) {
        const page1 = document.querySelector(".page_1");
        const page2 = document.querySelector(".page_2");
        page1.style.display = "none";
        page2.style.display = "none";
        page3.style.display = "flex";

        recordsTableBody.innerHTML = "";

        records.forEach((record, index) => {
            const tr = document.createElement("tr");

            const tdPlace = document.createElement("td");
            tdPlace.textContent = index + 1;

            const tdName = document.createElement("td");
            tdName.textContent = record.name;

            const tdAttempts = document.createElement("td");
            tdAttempts.textContent = record.record;

            tr.append(tdPlace, tdName, tdAttempts);
            recordsTableBody.appendChild(tr);
        });
    }

    backToMenuBtn.addEventListener("click", () => {
        page3.style.display = "none";
        const page1 = document.querySelector(".page_1");
        page1.style.display = "flex";
    });
    async function fetchRecords(n = 10) {
        try {
            const res = await fetch("http://localhost:3000/get_records", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ n: n })
            });

            if (!res.ok) {
                console.error("Ошибка при получении рекордов");
                return;
            }

            const data = await res.json();
            showRecordsPage(data);
        } catch (err) {
            console.error("Ошибка получения рекордов:", err);
        }
    }
});

document.addEventListener("DOMContentLoaded", () => {

    let ws;
    let roomId;

    page2.style.display = "none"; // скрываем page2 изначально
    form.style.display = "none";  // скрываем форму подключения

    // --- Показ/скрытие формы подключения ---
    connectRoomBtn.addEventListener("click", () => {
        if (form.style.display === "flex") {
            form.style.display = "none";
            connectRoomBtn.textContent = "Подключиться к существующей комнате";
        } else {
            form.style.display = "flex";
            connectRoomBtn.textContent = "Скрыть форму подключения";
        }
    });

    // --- Создать новую комнату ---
    createRoomBtn.addEventListener("click", async () => {
        try {
            const res = await fetch("http://localhost:3000/create_room");
            const data = await res.json();
            roomId = data.room_id;

            setTimeout(() => {
                startGame(roomId);
            }, 400);
        } catch (err) {
            console.error("Ошибка при создании комнаты:", err);
            roomError.textContent = "Не удалось создать комнату";
        }
    });

    // --- Подключение к существующей комнате ---
    form.addEventListener("submit", (e) => {
        e.preventDefault();
        roomId = inputRoomId.value.trim();
        if (!roomId) {
            roomError.textContent = "Введите ID комнаты!";
            return;
        }
        startGame(roomId);
    });

    // --- Начало игры ---
    function startGame(roomId) {
        page1.style.display = "none";
        page2.style.display = "flex";
        roomHeader.innerHTML = `Комната: <span style="color: #00FF7F; font-family: Calibri">${roomId}</span>`;
        setupWebSocket(roomId);
    }

    // --- WebSocket ---
    function setupWebSocket(roomId) {
        ws = new WebSocket(`ws://localhost:3000/ws/${roomId}`);

        ws.onopen = () => {
            addMessage("Соединение с сервером установлено");
        };

        let role; // 1 или 2
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);

            switch (data.type) {
                case "role":
                    role = data.role;
                    addMessage(data.message);
                    if (role === 2) messageInput.disabled = true; // второй пока не может писать
                    break;
                case "lock_input":
                    messageInput.disabled = true; // первый больше не вводит
                    break;
                case "length":
                    addMessage(`Длина слова: ${data.length}`);
                    messageInput.disabled = false; // второй теперь может писать
                    break;
                case "attempt":
                    addMessage(`Попытка ${data.n}: ${data.word} — Быки: ${data.bulls}, Коровы: ${data.cows}`);
                    break;
                case "win":
                    messageInput.disabled = true;
                    addMessage("Игрок отгадал слово! Игра окончена.");
                    if (role === 2) {
                        console.log("Player 2, attempts =", data.attempts);
                        checkAndSaveRecord(data.attempts);
                    };
                    break;
                case "info":
                    addMessage(data.message);
                    break;
                case "error":
                    alert(data.message);
                    location.reload();
                    break;
            }
        };

        ws.onclose = () => addMessage("Соединение закрыто");
        ws.onerror = (err) => console.error("WebSocket ошибка:", err);

        // --- Отправка слова / угадывания ---
        sendBtn.addEventListener("click", (e) => {
            e.preventDefault();
            const msg = messageInput.value.trim();
            if (!msg) return;
            ws.send(msg);
            messageInput.value = "";
        });

        // --- Кнопка выхода ---
        cancelBtn.addEventListener("click", () => {
            ws.close();
            location.reload();
        });
    }

    // --- Чат ---
    function addMessage(text) {
        const li = document.createElement("li");
        li.textContent = text;
        if (text.includes("Игрок отгадал слово")) {
            li.style.color = "limegreen"; 
            li.style.fontWeight = "bold";
        }
        messagesUl.appendChild(li);
        const chatBox = document.querySelector(".page_2_chat");
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    async function checkAndSaveRecord(attempts) {
        try {
            const res = await fetch("http://localhost:3000/best_record");
            const data = await res.json();

            const bestRecord = data.record;

            if (bestRecord === null || attempts < bestRecord) {
                const wantSave = confirm(
                    "Поздравляем! Вы установили новый рекорд.\nСохранить результат?"
                );

                if (!wantSave) return;

                const name = prompt("Введите ваше имя:");
                if (!name || name.trim().length < 3) {
                    alert("Имя должно быть не короче 3 символов");
                    return;
                }

                await saveRecord(name.trim(), attempts);
            }
        } catch (err) {
            console.error("Ошибка проверки рекорда:", err);
        }
    }

    async function saveRecord(name, attempts) {
        try {
            let validName = name;

            while (true) {
                // проверка минимальной длины
                if (!validName || validName.trim().length < 3) {
                    validName = prompt("Имя должно быть не короче 3 символов. Введите имя:");
                    continue; // вернемся на проверку
                }

                const res = await fetch("http://localhost:3000/create_record", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        name: validName.trim(),
                        record: attempts
                    })
                });

                if (res.ok) {
                    alert("Рекорд успешно сохранён!");
                    break; // выход из цикла
                } else {
                    const err = await res.json();
                    // если имя уже существует, попросить новое
                    if (err.detail && err.detail.includes("уже существует")) {
                        validName = prompt("Имя уже занято, введите другое:");
                        continue;
                    } else {
                        alert(err.detail || "Ошибка сохранения рекорда");
                        break;
                    }
                }
            }
        } catch (err) {
            console.error("Ошибка сохранения рекорда:", err);
        }
    }



});
