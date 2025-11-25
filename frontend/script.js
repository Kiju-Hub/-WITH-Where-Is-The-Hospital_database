let map;

// Kakao Maps 로드
kakao.maps.load(() => {
    map = new kakao.maps.Map(document.getElementById("map"), {
        center: new kakao.maps.LatLng(37.5665, 126.9780), // 서울 중심
        level: 6
    });
});

// 병원 조회 버튼 클릭
document.getElementById("loadBtn").addEventListener("click", async () => {
    const region = document.getElementById("region").value;
    if (!region) return alert("지역을 선택하세요!");

    const res = await fetch(`http://127.0.0.1:5000/api/hospitals?region=${region}`);
    const hospitals = await res.json();

    renderHospitalList(hospitals);
    renderMarkers(hospitals);
});

// 병원 목록 표시
function renderHospitalList(hospitals) {
    const box = document.getElementById("hospital-list");
    box.innerHTML = "";

    hospitals.forEach(h => {
        const item = document.createElement("div");
        item.className = "hospital-item";
        item.innerHTML = `
            <strong>${h["요양기관명"]}</strong><br>
            주소: ${h["주소"]}<br>
            전화: ${h["전화번호"] || "정보 없음"}
        `;
        box.appendChild(item);
    });
}

// 지도에 마커 표시
function renderMarkers(hospitals) {
    hospitals.forEach(h => {
        const lat = parseFloat(h["위도"]);
        const lng = parseFloat(h["경도"]);

        if (!lat || !lng) return;

        new kakao.maps.Marker({
            position: new kakao.maps.LatLng(lat, lng),
            map: map
        });
    });
}
