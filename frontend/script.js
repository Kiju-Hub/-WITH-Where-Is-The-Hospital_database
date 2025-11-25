document.addEventListener("DOMContentLoaded", function() {
    let map;
    let markers = [];       // 병원 마커 배열
    let userMarker = null;  // 내 위치 마커 (별 모양)
    let ps;
    let selectedMarkerIndex = -1;

    // 이미지 주소 (카카오 공식 주소)
    const IMG_BLUE = "https://t1.daumcdn.net/mapjsapi/images/marker.png";
    const IMG_RED = "https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/marker_red.png";
    // 내 위치는 '별' 마커로 표시 (노란색 핀 파일이 없어서 별이 가장 깔끔합니다)
    const IMG_USER = "https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/markerStar.png"; 

    // 1. 지도 초기화 (가장 먼저 실행됨)
    const container = document.getElementById("map");
    kakao.maps.load(() => {
        const options = { center: new kakao.maps.LatLng(37.5665, 126.9780), level: 5 };
        map = new kakao.maps.Map(container, options);
        ps = new kakao.maps.services.Places();
        
        // [중요] 초기화가 끝난 이 시점부터 kakao.maps.Size 같은 기능을 쓸 수 있습니다.
    });

    // 2. 검색 버튼 클릭
    const btn = document.getElementById("myLocationBtn");
    if (btn) {
        btn.addEventListener("click", () => {
            const radius = document.getElementById("radiusSelect").value;
            const keyword = document.getElementById("keywordInput").value.trim();
            const statusMsg = document.getElementById("status-msg");

            if (!navigator.geolocation) return alert("위치 정보를 사용할 수 없습니다.");

            statusMsg.innerText = "🛰️ 위치 찾는 중...";
            
            navigator.geolocation.getCurrentPosition(async (position) => {
                const lat = position.coords.latitude;
                const lon = position.coords.longitude;
                statusMsg.innerText = "🏥 데이터 조회 중...";
                
                if (map) {
                    const myPos = new kakao.maps.LatLng(lat, lon);
                    map.setCenter(myPos);
                    
                    if (userMarker) userMarker.setMap(null);
                    
                    // [내 위치 마커 생성] - 이곳은 버튼 클릭 후라 안전하게 생성 가능
                    const userSize = new kakao.maps.Size(24, 35);
                    const userImg = new kakao.maps.MarkerImage(IMG_USER, userSize); 
                    
                    userMarker = new kakao.maps.Marker({ 
                        position: myPos, 
                        map: map, 
                        title: "내 위치",
                        image: userImg,
                        zIndex: 3 
                    });
                }

                await loadHospitals(lat, lon, keyword, radius);
                statusMsg.innerText = "✅ 완료!";
            }, (err) => {
                console.error(err);
                statusMsg.innerText = "위치 확보 실패";
            });
        });
    }

    // 3. 데이터 로드
    async function loadHospitals(lat, lon, keyword, radius) {
        try {
            const url = `http://127.0.0.1:5000/api/hospitals?lat=${lat}&lon=${lon}&keyword=${keyword}&radius=${radius}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error("API Error");
            const hospitals = await res.json();

            if (hospitals.length === 0) {
                alert("검색 결과가 없습니다.");
                document.getElementById("hospital-list").innerHTML = "<div style='padding:20px; text-align:center;'>검색 결과가 없습니다.</div>";
                removeMarkers();
                return;
            }

            renderMarkers(hospitals);
            renderHospitalList(hospitals);

        } catch (error) {
            console.error(error);
            alert("서버 연결 실패 (파이썬 확인)");
        }
    }

    // 4. 마커 표시 (기본 파란색)
    function renderMarkers(hospitals) {
        removeMarkers();
        selectedMarkerIndex = -1;

        // 마커 크기 설정 (여기서는 안전함)
        const size = new kakao.maps.Size(24, 35);
        const blueImg = new kakao.maps.MarkerImage(IMG_BLUE, size);

        hospitals.forEach((h, index) => {
            const marker = new kakao.maps.Marker({
                position: new kakao.maps.LatLng(h.lat, h.lng),
                map: map,
                title: h.name,
                image: blueImg, // 기본: 파랑
                zIndex: 1
            });

            kakao.maps.event.addListener(marker, 'click', function() {
                selectHospital(index, h.lat, h.lng);
            });

            markers.push(marker);
        });
    }

    // 5. 목록 표시
    function renderHospitalList(hospitals) {
        const listDiv = document.getElementById("hospital-list");
        listDiv.innerHTML = "";

        hospitals.forEach((h, index) => {
            const item = document.createElement("div");
            item.className = "hospital-item"; 
            item.id = `item-${index}`; 

            item.innerHTML = `
                <div style="font-weight:bold; font-size:1.1em; margin-bottom:5px;">${h.name}</div>
                <div style="font-size:0.9em; color:#666;">${h.address}</div>
                <div style="font-size:0.8em; color:#888; margin:5px 0;">
                    ${h.phone || "-"} | <span style="color:#d9534f; font-weight:bold;">${h.distance}km</span>
                </div>
                <button class="detail-btn" style="width:100%; margin-top:5px; background:#FAE100; color:#3b1e1e; border:none; padding:8px; border-radius:4px; font-weight:bold; cursor:pointer;">
                    카카오맵 상세정보 >
                </button>
            `;

            item.onclick = (e) => {
                if (e.target.tagName === 'BUTTON') return;
                selectHospital(index, h.lat, h.lng);
            };

            const btn = item.querySelector(".detail-btn");
            btn.onclick = () => {
                findAndOpenDetail(h.name, h.lat, h.lng);
            };

            listDiv.appendChild(item);
        });
    }

    // 6. 병원 선택 (색상 교체)
    function selectHospital(index, lat, lng) {
        const size = new kakao.maps.Size(24, 35);
        const blueImg = new kakao.maps.MarkerImage(IMG_BLUE, size);
        const redImg = new kakao.maps.MarkerImage(IMG_RED, size);

        // 이전 선택된 마커 복구
        if (selectedMarkerIndex !== -1 && markers[selectedMarkerIndex]) {
            markers[selectedMarkerIndex].setImage(blueImg); 
            markers[selectedMarkerIndex].setZIndex(1);
            
            const prevItem = document.getElementById(`item-${selectedMarkerIndex}`);
            if (prevItem) prevItem.classList.remove("active");
        }

        // 현재 선택된 마커 변경
        if (markers[index]) {
            markers[index].setImage(redImg); 
            markers[index].setZIndex(2);
            
            map.panTo(new kakao.maps.LatLng(lat, lng));
            
            const currItem = document.getElementById(`item-${index}`);
            if (currItem) {
                currItem.classList.add("active");
                currItem.scrollIntoView({ behavior: "smooth", block: "center" });
            }

            selectedMarkerIndex = index;
        }
    }

    // 7. 마커 전체 삭제
    function removeMarkers() {
        for (let i = 0; i < markers.length; i++) {
            markers[i].setMap(null);
        }
        markers = [];
    }

    // 8. 상세페이지 열기
    function findAndOpenDetail(name, lat, lng) {
        if (!ps) return;
        const options = { location: new kakao.maps.LatLng(lat, lng), radius: 50 };
        ps.keywordSearch(name, (data, status) => {
            if (status === kakao.maps.services.Status.OK) {
                window.open(`https://place.map.kakao.com/${data[0].id}`, '_blank');
            } else {
                window.open(`https://map.kakao.com/link/search/${name}`, '_blank');
            }
        }, options);
    }
});