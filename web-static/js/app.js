/* TMS เวอร์ชันไฟล์ — hash routing: สลับหน้าโดยไม่ต้องรัน server */
(function () {
  'use strict'
  var PAGES = window.TMS_PAGES || {}
  var TITLES = window.TMS_TITLES || {}
  var content = document.getElementById('content')

  function normalize(h) {
    try { return decodeURIComponent(h.replace(/^#\/?/, '')) } catch (e) { return '' }
  }

  function render(route) {
    if (route === 'login') {
      document.body.classList.add('login-mode')
    } else {
      document.body.classList.remove('login-mode')
      var html = PAGES[route]
      if (html === undefined) { route = ''; html = PAGES[''] }
      content.innerHTML = html
      window.scrollTo(0, 0)
    }
    var links = document.querySelectorAll('.nav-link')
    for (var i = 0; i < links.length; i++) {
      links[i].classList.toggle('active', normalize(links[i].getAttribute('href') || '') === route)
    }
    document.title = (TITLES[route] ? TITLES[route] + ' — ' : '') + 'TMS (ไฟล์สำเร็จรูป)'
  }

  window.addEventListener('hashchange', function () { render(normalize(location.hash)) })
  // คลิกซ้ำที่ลิงก์เดิม → เลื่อนขึ้นบนสุด
  document.addEventListener('click', function (e) {
    var t = e.target
    var a = t && t.closest ? t.closest('a[href^="#/"]') : null
    if (a && normalize(a.getAttribute('href')) === normalize(location.hash)) window.scrollTo(0, 0)
  })
  render(normalize(location.hash))
})()
